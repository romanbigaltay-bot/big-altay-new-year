/* ------------------------------------------------------------------------
   LEAD INTEGRATION (общий модуль для всех форм лендинга)
   Проект: big-altay-new-year | Регламент: AGENTS.md §3, §6

   Архитектура: браузер НЕ знает секретный webhook Bitrix24. Формы шлют
   JSON на ENDPOINT (по умолчанию '/server.php' — серверный прокси, см.
   корневой server.php), а прокси уже создаёт лид через crm.lead.add.
   Для локального теста без PHP можно задать другой endpoint через
   window.LEADS_ENDPOINT (например, прямой webhook — только на дев-машине!).
   ------------------------------------------------------------------------ */
(function (global) {
    'use strict';

    // Серверный прокси заявок. На Beget лежит в корне сайта рядом с index.html.
    const ENDPOINT = global.LEADS_ENDPOINT || '/server.php';
    const REQUEST_TIMEOUT_MS = 12000;

    // Санатории: value из формы -> человекочитаемое название для CRM
    const SANATORIUM_LABELS = {
        belokurikha: 'Санаторий «Белокуриха»',
        sibir: 'Санаторий «Сибирь»',
        katun: 'Санаторий «Катунь»',
        help: 'Помогите выбрать'
    };

    // Способ связи: value из формы -> префикс TITLE и текст в комментарий
    const METHOD_LABELS = {
        call: 'звонок',
        email: 'email',
        max: 'MAX'
    };

    /**
     * Единственная точка выхода на сервер заявок (прокси server.php).
     * @param {Object} payload Произвольный JSON-объект (поля форм + source)
     * @returns {Promise<number>} ID созданного лида (0 — «успех» для honeypot)
     */
    async function submitLead(payload) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json;charset=UTF-8' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            let data = null;
            try {
                data = await response.json();
            } catch (_) {
                throw new Error(`Сервер вернул некорректный ответ (HTTP ${response.status})`);
            }

            if (!response.ok || !data || data.ok !== true) {
                throw new Error((data && data.error) || `HTTP ${response.status}`);
            }
            return typeof data.id === 'number' ? data.id : 0;
        } finally {
            clearTimeout(timer);
        }
    }

    /** Заявка с основной формы бронирования (#bookingMainForm) */
    function leadFromBookingForm(form) {
        const get = (id) => {
            const el = document.getElementById(id);
            return el ? el.value.trim() : '';
        };

        const sanatoriumVal = get('bookingSanatoriumInput');
        const sanatoriumLabel = SANATORIUM_LABELS[sanatoriumVal] || sanatoriumVal;
        const name = get('bookingName');
        const method = get('bookingMethodInput');
        const contact = get('bookingPhone');
        const dates = get('formBookingDatesInput');
        const duration = get('formBookingDurationInput');
        const guests = get('bookingGuestsHidden');
        const adults = get('formAdultsInput');
        const children = get('formChildrenInput');
        const comment = get('bookingComment');

        // payload для серверного прокси (server.php сам соберёт лид в CRM)
        const payload = {
            source: 'booking',
            name,
            phone: contact,
            sanatorium: sanatoriumLabel,
            checkIn: get('bookingDateStart') || '',
            checkOut: get('bookingDateEnd') || '',
            dates,
            nights: duration,
            guests: guests || `${adults || '—'} взр. / ${children || 0} дет.`,
            adults,
            children,
            contactMethod: METHOD_LABELS[method] || method,
            comment
        };

        // Если способ связи — email, кладём адрес в отдельное поле
        if (method === 'email' && contact.includes('@')) {
            payload.email = contact;
            payload.phone = '';
        }

        return payload;
    }

    /** Заявка с формы быстрой консультации (#quickConsultForm) */
    function leadFromQuickConsultForm(phone) {
        return {
            source: 'consult',
            name: 'Гость лендинга',
            phone
        };
    }

    global.BigAltayCRM = {
        submitLead,
        leadFromBookingForm,
        leadFromQuickConsultForm
    };
})(window);
