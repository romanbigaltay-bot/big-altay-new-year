<?php
/**
 * LEAD HANDLER — серверный прокси для приёма заявок с лендинга (Beget / любой PHP-хостинг).
 *
 * Назначение:
 *  - Скрывает секретный URL вебхука Bitrix24 от посетителей сайта
 *    (вебхук больше НЕ лежит в публичном JS-коде).
 *  - Принимает POST /server.php c JSON из форм лендинга, нормализует данные
 *    и создаёт лид в CRM через crm.lead.add.
 *
 * Развёртывание на Beget:
 *  1. Загрузите этот файл в корень сайта (рядом с index.html).
 *  2. Впишите актуальный webhook-URL ниже в $WEBHOOK_URL
 *     (или положите его в config.local.php и оставьте require — см. строку ~30).
 *  3. Права файла: 644. Никаких дополнительных настроек не требуется.
 *
 * Безопасность (многослойная):
 *  - Секрет (URL вебхука) не покидает сервер.
 *  - CORS: принимаем запросы только со своего домена (см. $ALLOWED_ORIGINS).
 *  - honeypot: скрытое поле site_email — боты его заполняют, люди нет.
 *  - rate-limit: не более 5 заявок с одного IP в минуту (файловый счётчик).
 *  - строгая валидация и лимиты длины всех полей перед отправкой в CRM.
 */

declare(strict_types=1);

// ===== КОНФИГУРАЦИЯ =========================================================

// Секретный webhook — ТОЛЬКО на сервере. Обязательный источник значения —
// config.local.php (не коммитится, см. .gitignore). Если файла нет или он не
// определяет $WEBHOOK_URL — прокси отвечает 500: секрет не должен попадать
// в публичный git-репозиторий даже на дев-полигоне.
$WEBHOOK_URL = null;
if (is_readable(__DIR__ . '/config.local.php')) {
    require __DIR__ . '/config.local.php'; // должен определить $WEBHOOK_URL
}
if (!$WEBHOOK_URL) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Сервер заявок не настроен (нет config.local.php)']);
    exit;
}

// Разрешённые источники CORS (боевой домен + превью + локальная разработка)
$ALLOWED_ORIGINS = [
    'https://bolshoyaltay.ru',
    'https://www.bolshoyaltay.ru',
    'https://big-altay.ru',
    'https://www.big-altay.ru',
    'https://romanbigaltay-bot.github.io', // dev-полигон / GitHub Pages
    'http://localhost:8080',
    'http://localhost:3000',
    'http://127.0.0.1:8080',
];

$RATE_LIMIT_MAX   = 5;    // заявок в окне
$RATE_LIMIT_WINDOW = 60;  // секунд

// ===========================================================================

// ---- CORS ------------------------------------------------------------------
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && in_array($origin, $ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 86400');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json; charset=utf-8');

/** JSON-ответ и остановка. */
function respond(int $code, array $payload): void
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

// ---- Только POST ------------------------------------------------------------
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'Метод не поддерживается']);
}

// ---- Тело запроса -----------------------------------------------------------
$raw  = file_get_contents('php://input');
$data = json_decode($raw ?: '', true);
if (!is_array($data)) {
    respond(400, ['ok' => false, 'error' => 'Некорректный JSON']);
}
if (strlen($raw) > 32768) {
    respond(413, ['ok' => false, 'error' => 'Слишком большой запрос']);
}

// ---- honeypot (заполнено => бот) ---------------------------------------------
if (!empty($data['site_email'])) {
    respond(200, ['ok' => true, 'id' => 0]); // притворяемся успешным, чтобы бот не повторял
}

// ---- rate limit по IP ---------------------------------------------------------
$ip  = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$tmp = sys_get_temp_dir();
$key = $tmp . '/leadrl_' . md5($ip);
$now = time();
$hits = [];
if (is_readable($key)) {
    $hits = array_values(array_filter(
        explode(',', trim((string)file_get_contents($key))),
        fn($t) => ($now - (int)$t) < $RATE_LIMIT_WINDOW
    ));
}
if (count($hits) >= $RATE_LIMIT_MAX) {
    respond(429, ['ok' => false, 'error' => 'Слишком много заявок, попробуйте позже']);
}
$hits[] = (string)$now;
@file_put_contents($key, implode(',', $hits));

// ---- Валидация и нормализация ---------------------------------------------------
/** Обрезка/очистка строки с лимитом длины. */
function clean(?string $v, int $max = 500): string
{
    $v = trim(preg_replace('/\s+/u', ' ', (string)$v));
    return mb_substr($v, 0, $max);
}

$name  = clean($data['name'] ?? '', 120);
$phone = preg_replace('/[^0-9+]/', '', (string)($data['phone'] ?? ''));
$emailRaw = clean($data['email'] ?? '', 120);
$sourceType = in_array($data['source'] ?? '', ['booking', 'consult'], true) ? $data['source'] : 'booking';

if ($name === '') {
    respond(400, ['ok' => false, 'error' => 'Укажите имя']);
}
// Нужен хотя бы один контакт: телефон (>=10 цифр) либо email
if (mb_strlen($phone) < 10 && !filter_var($emailRaw, FILTER_VALIDATE_EMAIL)) {
    respond(400, ['ok' => false, 'error' => 'Укажите корректный телефон или email']);
}

// Дополнительные поля форм (sanatorium, dates, guests, programs, contactMethod, comment...)
$extraFields = ['sanatorium', 'checkIn', 'checkOut', 'dates', 'nights', 'guests', 'adults', 'children',
                'contactMethod', 'comment', 'message', 'topic', 'email'];
$extras = [];
;
foreach ($extraFields as $f) {
    if (isset($data[$f]) && is_scalar($data[$f]) && clean((string)$data[$f]) !== '') {
        $extras[$f] = clean((string)$data[$f], 300);
    }
}

// ---- Сборка лида (по образцу functions.php основного сайта) ---------------------
$formTitles = [
    'booking' => 'Новый год 2027',
    'consult' => 'Консультация — Новый год 2027',
];
$page      = clean((string)($data['page'] ?? ''), 500);
$pageTitle = clean((string)($data['pageTitle'] ?? ''), 300);
$formId    = clean((string)($data['formId'] ?? $sourceType), 60);
$formTitle = clean((string)($data['formTitle'] ?? ($formTitles[$sourceType] ?? '')), 200);
$referrer  = clean((string)($data['referrer'] ?? ''), 500);
if ($page === '') { // fallback: referer запроса или сам лендинг
    $page = isset($_SERVER['HTTP_REFERER']) ? clean($_SERVER['HTTP_REFERER'], 500) : '';
}

// UTM из payload.utm {}
$utmRaw = $data['utm'] ?? [];
$utm = [];
foreach (['source', 'medium', 'campaign', 'content', 'term'] as $k) {
    if (is_array($utmRaw) && isset($utmRaw[$k]) && is_scalar($utmRaw[$k])) {
        $v = clean((string)$utmRaw[$k], 200);
        if ($v !== '') $utm[$k] = $v;
    }
}

// Заголовок лида: "Имя | Контакт — Новый год 2027 · Санаторий «X»"
// (без ярлыков «заявка/форма» — всё видно из контекста)
$contactLabel = $phone !== '' ? $phone : ($emailRaw !== '' ? $emailRaw :
    (($extras['contactMethod'] ?? '') === 'MAX' ? 'Чат MAX' : ''));
$title = ($name !== '' ? $name . ' | ' : '') . ($contactLabel !== '' ? $contactLabel : 'Заявка');
$title .= ' — Новый год 2027';
if (!empty($extras['sanatorium'])) $title .= ' · ' . $extras['sanatorium'];

// Комментарий в таймлайн (как в functions.php)
$methodLabels = ['звонок' => 'Телефон', 'email' => 'Email', 'MAX' => 'Чат MAX'];
$c   = [];
$c[] = '📌 ДЕТАЛИ ЗАЯВКИ С ЛЕНДИНГА «НОВЫЙ ГОД 2027»';
$c[] = '----------------------------------------';
if ($name !== '')                          $c[] = "👤 Имя: {$name}";
if ($phone !== '')                         $c[] = "📞 Телефон: {$phone}";
if ($emailRaw !== '')                      $c[] = "📧 Email: {$emailRaw}";
if (!empty($extras['contactMethod']))      $c[] = '💬 Канал связи: ' . ($methodLabels[$extras['contactMethod']] ?? $extras['contactMethod']);
if (!empty($extras['sanatorium']))         $c[] = '🏔 Санаторий: ' . $extras['sanatorium'];
if (!empty($extras['dates']))              $c[] = '📅 Даты заезда: ' . $extras['dates'];
if (!empty($extras['nights']))             $c[] = '⏳ Ночей: ' . $extras['nights'];
if (!empty($extras['guests']))             $c[] = '👥 Гостей: ' . $extras['guests'];
if (!empty($extras['comment']))            $c[] = '📝 Комментарий / Пожелания: ' . $extras['comment'];
$c[] = '';
$c[] = '----------------------------------------';
$c[] = '📍 СТРАНИЦА И ИСТОЧНИК';
$c[] = '----------------------------------------';
$c[] = '📄 Страница: ' . ($pageTitle !== '' ? $pageTitle : 'Лендинг «Новый год 2027»');
if ($page !== '')     $c[] = "🌐 URL: {$page}";
if ($formTitle !== '' || $formId !== '') $c[] = '📋 Форма: ' . ($formTitle !== '' ? $formTitle : $formId);
if ($referrer !== '' && $referrer !== $page) $c[] = "🔗 Реферер: {$referrer}";
$c[] = '';
$c[] = '----------------------------------------';
if ($utm) {
    $c[] = '🎯 UTM МЕТКИ';
    $c[] = '----------------------------------------';
    $utmNames = ['source' => 'Источник (utm_source)', 'medium' => 'Канал (utm_medium)',
                 'campaign' => 'Кампания (utm_campaign)', 'content' => 'Содержание (utm_content)',
                 'term' => 'Ключевое слово (utm_term)'];
    foreach ($utm as $k => $v) $c[] = "• {$utmNames[$k]}: {$v}";
    $c[] = '----------------------------------------';
} else {
    $c[] = '🎯 UTM метки: отсутствуют (прямой заход / органика)';
    $c[] = '----------------------------------------';
}
$tz = new DateTimeZone('Europe/Moscow');
$c[] = '🕒 Время заявки: ' . (new DateTime('now', $tz))->format('d.m.Y H:i:s') . ' (МСК)';
$comments = implode("\n", $c);

// ---- Отправка в Bitrix24 ---------------------------------------------------------
// ВАЖНО: REST Bitrix24 принимает fields только как form-urlencoded поля
// fields[KEY]=value; multi-поля (PHONE/EMAIL) — вложенными fields[PHONE][0][VALUE].
// JSON-строкой массивы не принимаются (проверено: лид молча создаётся без телефона).
$formFields = [
    'TITLE'              => $title,
    'STATUS_ID'          => 'NEW',
    'SOURCE_ID'          => 'WEB',
    'SOURCE_DESCRIPTION' => $page,
    'COMMENTS'           => $comments,
];
if ($name !== '') $formFields['NAME'] = $name;
if ($phone !== '') {
    $formFields['PHONE'] = [['VALUE' => $phone, 'VALUE_TYPE' => 'WORK']];
}
if (filter_var($emailRaw, FILTER_VALIDATE_EMAIL)) { // payload.email из JS (способ связи email)
    $formFields['EMAIL'] = [['VALUE' => $emailRaw, 'VALUE_TYPE' => 'WORK']];
}
foreach ($utm as $k => $v) {
    $formFields['UTM_' . strtoupper($k)] = $v;
}

$post = [];
array_walk_recursive($formFields, function ($v, $k) use (&$post) {
    $post["fields[$k]"] = (string)$v;
});

$ch = curl_init(rtrim($WEBHOOK_URL, '/') . '/crm.lead.add.json');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => http_build_query($post),
    CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded;charset=UTF-8'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_CONNECTTIMEOUT => 5,
]);
$response = curl_exec($ch);
$errNo    = curl_errno($ch);
$httpCode = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

if ($errNo !== 0) {
    error_log('lead handler: curl error ' . $errNo . ' — ' . $response);
    respond(502, ['ok' => false, 'error' => 'Сервер CRM недоступен, попробуйте позже']);
}

$result = json_decode((string)$response, true);
$leadId = $result['result'] ?? null;

if ($httpCode !== 200 || !is_numeric($leadId)) {
    error_log('lead handler: bitrix response ' . $httpCode . ' — ' . substr((string)$response, 0, 1000));
    respond(502, ['ok' => false, 'error' => 'Не удалось создать заявку']);
}

respond(200, ['ok' => true, 'id' => (int)$leadId]);
