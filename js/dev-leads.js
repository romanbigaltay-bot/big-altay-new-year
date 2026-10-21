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
     * Прямая отправка payload в Bitrix24 (crm.lead.add) с REST-вебхука.
     * Формат такой же, как у server.php: {ok:true, id:<leadId>} / {ok:false, error}.
     * ВАЖНО: Bitrix24 принимает fields только как form-urlencoded (fields[K]=v,
     * массивы — JSON-строкой), поэтому сериализуем через URLSearchParams.
     */
    async function devSubmitLead(payload) {
        const hook = global.LEADS_ENDPOINT;
        if (!hook) throw new Error('DEV endpoint не собран');

        const titleMap = {
            booking: 'Заявка на бронирование — Новый год 2027, Белокуриха',
            consult: 'Быстрая консультация — Новый год 2027, Белокуриха'
        };
        const source = payload.source === 'consult' ? 'consult' : 'booking';
        let title = titleMap[source];
        if (payload.sanatorium) title += ' · ' + payload.sanatorium;

        const lines = ['Источник: лендинг «Новый год 2027» (' + source + ', dev)',
                       'Имя: ' + (payload.name || ''),
                       'Телефон: ' + (payload.phone || '')];
        Object.keys(payload).forEach(function (k) {
            if (['source', 'name', 'phone'].indexOf(k) === -1 && payload[k]) {
                lines.push(k + ': ' + payload[k]);
            }
        });

        const fields = {
            TITLE: title,
            NAME: payload.name || '',
            COMMENTS: lines.join('\n'),
            STATUS_ID: 'NEW',
            SOURCE_ID: 1
        };
        if (payload.phone) fields.PHONE = [{ VALUE: payload.phone, VALUE_TYPE: 'WORK' }];
        if (payload.email) fields.EMAIL = [{ VALUE: payload.email, VALUE_TYPE: 'WORK' }];

        const body = new URLSearchParams();
        Object.keys(fields).forEach(function (k) {
            body.set('fields[' + k + ']', typeof fields[k] === 'object'
                ? JSON.stringify(fields[k])
                : String(fields[k]));
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
            return data.result; // lead ID
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
