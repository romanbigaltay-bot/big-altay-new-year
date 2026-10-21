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

    // ------------------------------------------------------------------
    // Контекст страницы и UTM (по образцу functions.php основного сайта)
    // ------------------------------------------------------------------

    const FORM_TITLES = {
        booking: 'Новый год 2027, Белокуриха',
        consult: 'Консультация — Новый год 2027, Белокуриха'
    };

    /** Читаем utm_* из query-строки текущего URL. */
    function collectUtm() {
        const p = new URLSearchParams(global.location.search);
        const utm = {};
        ['source', 'medium', 'campaign', 'content', 'term'].forEach(function (k) {
            const v = p.get('utm_' + k);
            if (v) utm[k] = v.trim();
        });
        return utm;
    }

    /**
     * Единый блок контекста заявки: страница, форма, реферер, UTM.
     * @param {string} formId 'booking' | 'consult'
     */
    function buildLeadContext(formId) {
        return {
            page: global.location.href.split('#')[0],
            pageTitle: document.title,
            formId: formId,
            formTitle: FORM_TITLES[formId] || formId,
            referrer: document.referrer || '',
            utm: collectUtm()
        };
    }

    /** Заявка с основной формы бронирования (#bookingMainForm) */

    // Человекочитаемые названия новогодних программ по санаториям (секция #programs).
    // Значение синхронизировано с активным табом; при клике обновляет hidden-поле формы.
    const PROGRAM_LABELS = {
        belokurikha: 'Белокуриха: «Высота 2027», «Дереза Пати», «Козырный Новый год»',
        sibir: 'Сибирь: «Тысяча масок и одна ночь», «Золотое руно»',
        katun: 'Катунь: «Новогодняя ночь — время быть вместе», «Музыкальный взрыв»'
    };

    function syncProgramField() {
        const hidden = document.getElementById('bookingProgramHidden');
        if (!hidden) return;
        const activeTab = document.querySelector('.programs-tab.is-active[data-program-tab]');
        const key = activeTab ? activeTab.dataset.programTab : '';
        hidden.value = PROGRAM_LABELS[key] || '';
    }

    function initProgramSync() {
        const tabsWrap = document.querySelector('.programs-tabs');
        if (!tabsWrap) return;
        // Делегирование: ловим переключение табов в секции #programs
        tabsWrap.addEventListener('click', syncProgramField);
        syncProgramField(); // начальная синхронизация (активен таб по умолчанию)
    }

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
        const program = get('bookingProgramHidden');

        // payload для транспорта (server.php на проде / dev-leads.js на дев-полигоне)
        const payload = {
            source: 'booking',
            name,
            phone: contact,
            sanatorium: sanatoriumLabel,
            program,
            checkIn: get('bookingDateStart') || '',
            checkOut: get('bookingDateEnd') || '',
            dates,
            nights: duration,
            guests: guests || `${adults || '—'} взр. / ${children || 0} дет.`,
            adults,
            children,
            contactMethod: METHOD_LABELS[method] || method,
            comment,
            ...buildLeadContext('booking')
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
            phone,
            ...buildLeadContext('consult')
        };
    }

    global.BigAltayCRM = {
        submitLead,
        leadFromBookingForm,
        leadFromQuickConsultForm,
        buildLeadContext,
        initProgramSync
    };

    // Автозапуск синхронизации программы с активным табом #programs
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initProgramSync);
    } else {
        initProgramSync();
    }
})(window);
