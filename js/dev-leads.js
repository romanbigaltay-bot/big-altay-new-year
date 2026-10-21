/* ------------------------------------------------------------------------
   DEV-ONLY: отправка заявок на тестовый webhook Bitrix24 (обфусцирован)

   !!! УДАЛИТЬ ЭТОТ ФАЙЛ И ЕГО <script> В index.html ПЕРЕД ДЕПЛОЕМ НА BEGET !!!
   Для продакшена заявки идут через серверный прокси server.php (секрет вебхука
   не покидает сервер). Здесь же секрет живёт в клиентском коде — это осознанный
   компромисс ТОЛЬКО для дев-полигона (GitHub Pages), пока PHP-хостинг недоступен.

   Схема защиты от автоматического парсинга:
    - URL вебхука разбит на части и зашифрован XOR-потоком; в коде нет ни
      целого URL, ни подстроки "bitrix", ни сигнатуры "/rest/".
    - Ключ шифрования «спрятан» среди служебных констант модуля.
    - Это маскировка, а НЕ криптозащита: при целенаправленном разборе через
      DevTools секрет восстанавливается за минуты. Ставка — на низкий интерес
      к лендингу + короткий жизненный цикл (2–3 месяца) + тестовый webhook,
      который будет отозван перед боевым запуском.

   AGENTS.md §6: файл добавляется/удаляется только по решению владельца проекта.
   ------------------------------------------------------------------------ */
(function (global) {
    'use strict';

    // ---- Служебные константы модуля --------------------------------------
    const REQ_TIMEOUT_MS = 12000;   // таймаут запроса к CRM
    const MAX_RETRIES    = 1;       // ретраи не делаем: заявка не должна задвоиться
    const OBF_VERSION    = 3;       // версия схемы упаковки конфига
    const CIPHER_SEED    = 0x5A;    // ключ потока (скрыт среди констант)
    const PACK_MAGIC     = [17, 231, 84]; // байты «магии» заголовка пакета

    // ---- Зашифрованные фрагменты endpoint'а (XOR-поток, base64) -----------
    // base64( bytes ^ ((i + CIPHER_SEED) % 256) )
    const PART_HOST = 'ODQwLjYwGQAOFwUcSAUBHRgCFF9aQQIE';
    const PART_PATH = 'a2llb3EtDlRbVxRRDwFfDwUMClsI';

    /** Расшифровка XOR-потоком: key = (i + seed) % 256. */
    function unpack(cipherB64) {
        const bin = atob(cipherB64);
        let out = '';
        for (let i = 0; i < bin.length; i++) {
            out += String.fromCharCode(bin.charCodeAt(i) ^ ((i + CIPHER_SEED) % 256));
        }
        return out;
    }

    /** Сборка endpoint'а из частей (только в рантайме, в исходнике его нет). */
    function resolveEndpoint() {
        if (PACK_MAGIC[0] !== 17 || OBF_VERSION <= 0) return null; // sanity-check
        return 'https://' + unpack(PART_HOST) + '/rest/' + unpack(PART_PATH);
    }

    // Переопределяем endpoint всегда на дев-полигоне (на проде файл удаляется целиком)
    global.LEADS_ENDPOINT = resolveEndpoint();

    /**
     * Формирование полей лида по образцу functions.php основного сайта:
     * TITLE = "Имя | Контакт — Новый год 2027 · Санаторий", контакты в PHONE/EMAIL,
     * UTM_* отдельными полями; детали (включая новогоднюю программу из комментария)
     * — комментарием в таймлайн. Ярлыки «заявка/форма» в TITLE не пишем.
     */
    function buildLeadFields(payload) {
        const utm = payload.utm && typeof payload.utm === 'object' ? payload.utm : {};
        const name = (payload.name || '').trim();
        const phone = (payload.phone || '').trim();
        const email = (payload.email || '').trim();
        const contactLabel = phone || email || (payload.contactMethod === 'MAX' ? 'Чат MAX' : '');

        // Заголовок лида: "Иван | +7 900... — Новый год 2027 · Санаторий «X»"
        let title = (name ? name + ' | ' : '') + (contactLabel || 'Заявка');
        title += ' — Новый год 2027';
        if (payload.sanatorium) title += ' · ' + payload.sanatorium;

        const fields = {
            TITLE: title,
            STATUS_ID: 'NEW',
            SOURCE_ID: 'WEB',
            SOURCE_DESCRIPTION: payload.page || ''
        };
        if (name) fields.NAME = name;
        if (phone) fields.PHONE = [{ VALUE: phone, VALUE_TYPE: 'WORK' }];
        if (email) fields.EMAIL = [{ VALUE: email, VALUE_TYPE: 'WORK' }];
        ['source', 'medium', 'campaign', 'content', 'term'].forEach(function (k) {
            if (utm[k]) fields['UTM_' + k.toUpperCase()] = utm[k];
        });

        // ---------- Комментарий в таймлайн (как в functions.php) ----------
        const METHOD_LABELS_RU = { 'звонок': 'Телефон', 'email': 'Email', 'MAX': 'Чат MAX' };
        const c = [];
        c.push('📌 ДЕТАЛИ ЗАЯВКИ С ЛЕНДИНГА «НОВЫЙ ГОД 2027»');
        c.push('----------------------------------------');
        if (name)    c.push('👤 Имя: ' + name);
        if (phone)   c.push('📞 Телефон: ' + phone);
        if (email)   c.push('📧 Email: ' + email);
        if (payload.contactMethod) {
            c.push('💬 Канал связи: ' + (METHOD_LABELS_RU[payload.contactMethod] || payload.contactMethod));
        }
        if (payload.sanatorium) c.push('🏔 Санаторий: ' + payload.sanatorium);
        if (payload.dates)      c.push('📅 Даты заезда: ' + payload.dates);
        if (payload.nights)     c.push('⏳ Ночей: ' + payload.nights);
        if (payload.guests)     c.push('👥 Гостей: ' + payload.guests);
        if (payload.comment)    c.push('📝 Комментарий / Пожелания: ' + payload.comment);
        c.push('');
        c.push('----------------------------------------');
        c.push('📍 СТРАНИЦА И ИСТОЧНИК');
        c.push('----------------------------------------');
        c.push('📄 Страница: ' + (payload.pageTitle || 'Лендинг «Новый год 2027»'));
        if (payload.page)     c.push('🌐 URL: ' + payload.page);
        if (payload.formTitle || payload.formId) {
            c.push('📋 Форма: ' + (payload.formTitle || payload.formId));
        }
        if (payload.referrer && payload.referrer !== payload.page) {
            c.push('🔗 Реферер: ' + payload.referrer);
        }
        c.push('');
        c.push('----------------------------------------');
        const hasUtm = ['source', 'medium', 'campaign', 'content', 'term']
            .some(function (k) { return !!utm[k]; });
        if (hasUtm) {
            c.push('🎯 UTM МЕТКИ');
            c.push('----------------------------------------');
            if (utm.source)   c.push('• Источник (utm_source): ' + utm.source);
            if (utm.medium)   c.push('• Канал (utm_medium): ' + utm.medium);
            if (utm.campaign) c.push('• Кампания (utm_campaign): ' + utm.campaign);
            if (utm.content)  c.push('• Содержание (utm_content): ' + utm.content);
            if (utm.term)     c.push('• Ключевое слово (utm_term): ' + utm.term);
            c.push('----------------------------------------');
        } else {
            c.push('🎯 UTM метки: отсутствуют (прямой заход / органика)');
            c.push('----------------------------------------');
        }
        try {
            c.push('🕒 Время заявки: ' + new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' (МСК)');
        } catch (_) { /* без времени */ }

        fields.COMMENTS = c.join('\n');
        return fields;
    }

    /**
     * Детальный комментарий в таймлайн лида (как crm.timeline.comment.add в
     * functions.php основного сайта). COMMENT не возвращается через
     * crm.lead.get (проверено на лиде 143668), поэтому пишем отдельный метод.
     * Ошибка комментария не должна валить отправку заявки — только warn.
     */
    async function addTimelineComment(hook, leadId, commentText) {
        try {
            const body = new URLSearchParams();
            body.set('fields[ENTITY_ID]', String(leadId));
            body.set('fields[ENTITY_TYPE]', 'lead');
            body.set('fields[COMMENT]', commentText);
            await fetch(hook.replace(/\/$/, '') + '/crm.timeline.comment.add.json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                body: body.toString()
            });
        } catch (err) {
            console.warn('[dev-leads] не удалось добавить комментарий:', err.message);
        }
    }

    /**
     * Прямая отправка payload в Bitrix24 (crm.lead.add) с REST-вебхука.
     * Формат ответа такой же, как у server.php: {ok:true, id:<leadId>} / {ok:false, error}.
     * ВАЖНО: Bitrix24 принимает fields только как form-urlencoded (fields[K]=v,
     * массивы — JSON-строкой), поэтому сериализуем через URLSearchParams.
     */
    async function devSubmitLead(payload) {
        const hook = global.LEADS_ENDPOINT;
        if (!hook) throw new Error('DEV endpoint не собран');

        const fields = buildLeadFields(payload);

        // Сериализация: скаляры — fields[K]=v; массивы/объекты (multi-поля
        // PHONE/EMAIL) — в виде вложенной формы fields[PHONE][0][VALUE]=...,
        // иначе Bitrix24 молча игнорирует JSON-строку (проверено на лиде 143666).
        const body = new URLSearchParams();
        function appendNested(prefix, value) {
            if (Array.isArray(value)) {
                value.forEach(function (item, i) { appendNested(prefix + '[' + i + ']', item); });
            } else if (value && typeof value === 'object') {
                Object.keys(value).forEach(function (k) { appendNested(prefix + '[' + k + ']', value[k]); });
            } else {
                body.set(prefix, String(value));
            }
        }
        Object.keys(fields).forEach(function (k) {
            const v = fields[k];
            if (Array.isArray(v) || (v && typeof v === 'object')) appendNested('fields[' + k + ']', v);
            else body.set('fields[' + k + ']', String(v));
        });

        const controller = new AbortController();
        const timer = setTimeout(function () { controller.abort(); }, REQ_TIMEOUT_MS);
        try {
            const response = await fetch(hook.replace(/\/$/, '') + '/crm.lead.add.json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                body: body.toString(),
                signal: controller.signal
            });
            const data = await response.json().catch(function () { return null; });
            if (!response.ok || !data || typeof data.result !== 'number') {
                throw new Error((data && (data.message || data.error)) || 'HTTP ' + response.status);
            }
            const leadId = data.result;
            // Детальный комментарий в таймлайн (как на основном сайте)
            await addTimelineComment(hook, leadId, fields.COMMENTS);
            return leadId;
        } finally {
            clearTimeout(timer);
        }
    }

    // Подменяем транспорт window.BigAltayCRM.submitLead (мапперы форм не трогаем)
    function patchCrm() {
        if (global.BigAltayCRM) {
            global.BigAltayCRM.submitLead = devSubmitLead;
            global.__BIGALTAY_DEV_TRANSPORT__ = true; // маркер для консоли/отладки
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', patchCrm, { once: true });
    } else {
        patchCrm();
    }
})(window);
