/**
 * ============================================================================
 * Big Altay • New Year 2027 Landing Page (Belokurikha)
 * Architecture: Clean Vanilla ES6+ (Zero external dependencies)
 * Modules:
 *  1. Falling Snow Canvas Shader (Performance-optimized, Retina-ready)
 *  2. Header Scroll & Mobile Drawer Navigation
 *  3. Sanatoriums Filter Tabs
 *  4. Booking Form (formerly "calculator" — decision: no price calculation,
 *     sales run through a manager; see AGENTS.md) + Bitrix24 lead creation
 *     via js/bitrix.js (window.BigAltayCRM)
 *  5. Accessible Accordion (FAQ)
 *  6. Modal Dialogs & Booking Triggers
 *  7. Form Validation & Toast Feedback
 * ============================================================================
 */

(function () {
    'use strict';

    /* ------------------------------------------------------------------------
       01. FALLING SNOW SHADER (CANVAS PARTICLE ENGINE)
       ------------------------------------------------------------------------ */
    function initSnowCanvas() {
        const canvas = document.getElementById('snow-canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let width = 0;
        let height = 0;
        let animationFrameId = null;
        let isVisible = true;

        // Snowflake Particle Collection
        const particleCount = window.innerWidth < 768 ? 45 : 85;
        const particles = [];

        function resize() {
            const rect = canvas.getBoundingClientRect();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            width = rect.width;
            height = rect.height;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            ctx.scale(dpr, dpr);
        }

        class Snowflake {
            constructor(isInitial = false) {
                this.reset(isInitial);
            }

            reset(isInitial = false) {
                this.x = Math.random() * width;
                this.y = isInitial ? Math.random() * height : -10;
                // Layer depth simulation: smaller flakes are further away, dimmer, slower
                this.depth = Math.random();
                this.radius = 1.2 + this.depth * 2.6; // 1.2px to 3.8px
                this.speedY = 0.4 + this.depth * 0.9;  // 0.4 to 1.3 px/frame
                this.speedX = (Math.random() - 0.5) * 0.4;
                this.swaySpeed = 0.01 + Math.random() * 0.02;
                this.swayOffset = Math.random() * Math.PI * 2;
                this.swayDistance = 15 + Math.random() * 25;
                this.opacity = 0.25 + this.depth * 0.55; // Soft diffused opacity
            }

            update(time) {
                this.y += this.speedY;
                this.x += Math.sin(time * this.swaySpeed + this.swayOffset) * 0.35 + this.speedX;

                // Wrap around edges
                if (this.y > height + 10) {
                    this.reset(false);
                }
                if (this.x < -20) {
                    this.x = width + 10;
                } else if (this.x > width + 20) {
                    this.x = -10;
                }
            }

            draw() {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(180, 215, 245, ${this.opacity})`;
                ctx.fill();
            }
        }

        // Initialize particles
        resize();
        for (let i = 0; i < particleCount; i++) {
            particles.push(new Snowflake(true));
        }

        let lastTime = 0;
        function render(time) {
            if (!isVisible) return;

            ctx.clearRect(0, 0, width, height);

            const t = time * 0.001;
            for (let i = 0; i < particles.length; i++) {
                particles[i].update(t);
                particles[i].draw();
            }

            animationFrameId = requestAnimationFrame(render);
        }

        // Pause loop when hero is offscreen to save battery and CPU
        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    isVisible = entry.isIntersecting;
                    if (isVisible && !animationFrameId) {
                        animationFrameId = requestAnimationFrame(render);
                    } else if (!isVisible && animationFrameId) {
                        cancelAnimationFrame(animationFrameId);
                        animationFrameId = null;
                    }
                });
            }, { threshold: 0.05 });

            const heroSection = document.getElementById('hero');
            if (heroSection) observer.observe(heroSection);
        } else {
            animationFrameId = requestAnimationFrame(render);
        }

        // Debounced resize
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                resize();
            }, 150);
        });
    }

    /* ------------------------------------------------------------------------
       02. STICKY HEADER & MOBILE DRAWER NAVIGATION
       ------------------------------------------------------------------------ */
    function initHeader() {
        const header = document.getElementById('header');
        const mobileMenuBtn = document.getElementById('mobileMenuBtn');
        const mobileMenu = document.getElementById('mobileMenu');
        const mobileLinks = document.querySelectorAll('.mobile-menu__link');

        // Sticky shadow state
        function onScroll() {
            if (!header) return;
            if (window.scrollY > 20) {
                header.classList.add('is-scrolled');
            } else {
                header.classList.remove('is-scrolled');
            }
        }
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();

        // Mobile drawer toggle
        if (mobileMenuBtn && mobileMenu) {
            mobileMenuBtn.addEventListener('click', () => {
                const isOpen = mobileMenu.classList.toggle('is-open');
                mobileMenuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            });

            // Close on link click
            mobileLinks.forEach(link => {
                link.addEventListener('click', () => {
                    mobileMenu.classList.remove('is-open');
                    mobileMenuBtn.setAttribute('aria-expanded', 'false');
                });
            });
        }
    }

    /* ------------------------------------------------------------------------
       03. INTEGRATED BOOKING FORM WITH DROPDOWNS & POPOVERS
       ------------------------------------------------------------------------ */
    function initBookingForm() {
        const form = document.getElementById('bookingMainForm');
        if (!form) return;

        // --- DROPDOWNS & POPOVER MANAGER ---
        const dropdownWraps = form.querySelectorAll('.form-dropdown-wrap');

        function closeAllDropdowns() {
            dropdownWraps.forEach(wrap => {
                wrap.classList.remove('is-open');
                const trigger = wrap.querySelector('.form-dropdown-trigger');
                if (trigger) trigger.setAttribute('aria-expanded', 'false');
            });
        }

        dropdownWraps.forEach(wrap => {
            const trigger = wrap.querySelector('.form-dropdown-trigger');
            if (!trigger) return;

            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = wrap.classList.contains('is-open');
                closeAllDropdowns();
                if (!isOpen) {
                    wrap.classList.add('is-open');
                    trigger.setAttribute('aria-expanded', 'true');
                }
            });
        });

        // Prevent click inside popover from bubbling and closing
        const popovers = form.querySelectorAll('.form-popover');
        popovers.forEach(pop => {
            pop.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!form.contains(e.target)) {
                closeAllDropdowns();
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeAllDropdowns();
            }
        });

        // --- 1. SANATORIUM SELECTION ---
        const sanatoriumWrap = document.getElementById('sanatoriumDropdownWrap');
        const sanatoriumTrigger = document.getElementById('sanatoriumDropdownTrigger');
        const sanatoriumTitle = document.getElementById('sanatoriumCurrentTitle');
        const sanatoriumSub = document.getElementById('sanatoriumCurrentSub');
        const sanatoriumInput = document.getElementById('bookingSanatoriumInput');
        const sanatoriumOptions = form.querySelectorAll('#sanatoriumPopover .form-popover__option');

        function selectSanatorium(val, title, sub) {
            if (sanatoriumTitle && title) sanatoriumTitle.textContent = title;
            if (sanatoriumSub && sub) sanatoriumSub.textContent = sub;
            if (sanatoriumInput && val) sanatoriumInput.value = val;

            sanatoriumOptions.forEach(opt => {
                if (opt.dataset.val === val) {
                    opt.classList.add('is-selected');
                } else {
                    opt.classList.remove('is-selected');
                }
            });

            if (sanatoriumWrap) {
                sanatoriumWrap.classList.remove('is-open');
                if (sanatoriumTrigger) sanatoriumTrigger.setAttribute('aria-expanded', 'false');
            }
        }

        sanatoriumOptions.forEach(opt => {
            opt.addEventListener('click', () => {
                selectSanatorium(opt.dataset.val, opt.dataset.title, opt.dataset.sub);
            });
        });

        // External "Забронировать номер" buttons from sanatorium cards
        const cardBookingButtons = document.querySelectorAll('[data-sanatorium-choice]');
        cardBookingButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const choice = btn.dataset.sanatoriumChoice;
                if (!choice) return;
                const matchOpt = form.querySelector(`#sanatoriumPopover .form-popover__option[data-val="${choice}"]`);
                if (matchOpt) {
                    selectSanatorium(matchOpt.dataset.val, matchOpt.dataset.title, matchOpt.dataset.sub);
                }
            });
        });

        // --- 2. CUSTOM CALENDAR (01 Dec 2026 to 28 Feb 2027) ---
        const datesWrap = document.getElementById('datesDropdownWrap');
        const datesTrigger = document.getElementById('datesDropdownTrigger');
        const datesTitle = document.getElementById('datesCurrentTitle');
        const datesSub = document.getElementById('datesCurrentSub');
        const calFooterSummary = document.getElementById('calFooterSummary');
        const calApplyBtn = document.getElementById('calApplyBtn');

        const formBookingDatesInput = document.getElementById('formBookingDatesInput');
        const formBookingDurationInput = document.getElementById('formBookingDurationInput');

        const calTabs = form.querySelectorAll('.booking-calendar__tab');
        const calGrid = document.getElementById('formCalendarGrid');

        const monthsData = [
            { name: 'Декабрь 2026', year: 2026, month: 11, days: 31 },
            { name: 'Январь 2027',  year: 2027, month: 0,  days: 31 },
            { name: 'Февраль 2027', year: 2027, month: 1,  days: 28 }
        ];

        let currentMonthIdx = 0; // 0 = Dec 2026, 1 = Jan 2027, 2 = Feb 2027
        let selectedStart = '2026-12-30';
        let selectedEnd = '2027-01-05';

        const festiveDates = new Set([
            '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
            '2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08'
        ]);

        const monthShortNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

        function formatDateStrRu(dStr) {
            if (!dStr) return '';
            const parts = dStr.split('-');
            const year = parts[0];
            const month = parseInt(parts[1], 10) - 1;
            const day = parseInt(parts[2], 10);
            return `${day < 10 ? '0' + day : day} ${monthShortNames[month]} ${year}`;
        }

        function pluralize(n, one, few, many) {
            const mod10 = n % 10;
            const mod100 = n % 100;
            if (mod100 >= 11 && mod100 <= 19) return `${n} ${many}`;
            if (mod10 === 1) return `${n} ${one}`;
            if (mod10 >= 2 && mod10 <= 4) return `${n} ${few}`;
            return `${n} ${many}`;
        }

        function calculateNights(startStr, endStr) {
            if (!startStr || !endStr) return 0;
            const s = new Date(startStr + 'T00:00:00');
            const e = new Date(endStr + 'T00:00:00');
            const diffMs = e - s;
            return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
        }

        function updateCalendarDisplay() {
            if (selectedStart && selectedEnd) {
                const nights = calculateNights(selectedStart, selectedEnd);
                const nightsText = pluralize(nights, 'ночь', 'ночи', 'ночей');
                const rangeFormatted = `${formatDateStrRu(selectedStart)} — ${formatDateStrRu(selectedEnd)}`;

                if (datesTitle) datesTitle.textContent = rangeFormatted;
                if (datesSub) datesSub.textContent = nightsText;
                if (calFooterSummary) calFooterSummary.textContent = nightsText;

                if (formBookingDatesInput) formBookingDatesInput.value = rangeFormatted;
                if (formBookingDurationInput) formBookingDurationInput.value = nightsText;

                if (calApplyBtn) calApplyBtn.disabled = false;
            } else if (selectedStart) {
                const startFormatted = formatDateStrRu(selectedStart);
                if (datesTitle) datesTitle.textContent = `Заезд: ${startFormatted}`;
                if (datesSub) datesSub.textContent = 'Выберите дату выезда';
                if (calFooterSummary) calFooterSummary.textContent = 'Выберите дату выезда';

                if (formBookingDatesInput) formBookingDatesInput.value = startFormatted;
                if (formBookingDurationInput) formBookingDurationInput.value = '';

                if (calApplyBtn) calApplyBtn.disabled = true;
            } else {
                if (datesTitle) datesTitle.textContent = 'Выберите даты';
                if (datesSub) datesSub.textContent = 'Дата заезда и выезда';
                if (calFooterSummary) calFooterSummary.textContent = 'Выберите даты заезда и выезда';

                if (formBookingDatesInput) formBookingDatesInput.value = '';
                if (formBookingDurationInput) formBookingDurationInput.value = '';

                if (calApplyBtn) calApplyBtn.disabled = true;
            }
        }

        function renderCalendar() {
            if (!calGrid) return;
            calGrid.innerHTML = '';

            const mData = monthsData[currentMonthIdx];

            calTabs.forEach((tab, idx) => {
                if (idx === currentMonthIdx) {
                    tab.classList.add('is-active');
                } else {
                    tab.classList.remove('is-active');
                }
            });

            // First day of month (Monday = 0, Sunday = 6)
            const firstDate = new Date(mData.year, mData.month, 1);
            let firstDayOfWeek = firstDate.getDay() - 1;
            if (firstDayOfWeek === -1) firstDayOfWeek = 6;

            // Empty prefix cells
            for (let i = 0; i < firstDayOfWeek; i++) {
                const emptyCell = document.createElement('div');
                emptyCell.className = 'cal-day is-empty';
                calGrid.appendChild(emptyCell);
            }

            // Days of the month
            for (let day = 1; day <= mData.days; day++) {
                const dayBtn = document.createElement('button');
                dayBtn.type = 'button';
                dayBtn.className = 'cal-day';
                dayBtn.textContent = day;

                const mm = String(mData.month + 1).padStart(2, '0');
                const dd = String(day).padStart(2, '0');
                const dateStr = `${mData.year}-${mm}-${dd}`;
                dayBtn.dataset.date = dateStr;

                if (festiveDates.has(dateStr)) {
                    dayBtn.classList.add('is-festive');
                }

                if (selectedStart && dateStr === selectedStart) {
                    dayBtn.classList.add('is-start');
                }
                if (selectedEnd && dateStr === selectedEnd) {
                    dayBtn.classList.add('is-end');
                }
                if (selectedStart && selectedEnd && dateStr > selectedStart && dateStr < selectedEnd) {
                    dayBtn.classList.add('is-range');
                }

                dayBtn.addEventListener('click', () => {
                    handleDaySelection(dateStr);
                });

                calGrid.appendChild(dayBtn);
            }
        }

        function handleDaySelection(dateStr) {
            if (!selectedStart || (selectedStart && selectedEnd)) {
                selectedStart = dateStr;
                selectedEnd = null;
            } else if (selectedStart && !selectedEnd) {
                if (dateStr < selectedStart) {
                    selectedStart = dateStr;
                    selectedEnd = null;
                } else if (dateStr === selectedStart) {
                    selectedEnd = null;
                } else {
                    selectedEnd = dateStr;
                }
            }

            renderCalendar();
            updateCalendarDisplay();
        }

        calTabs.forEach((tab, idx) => {
            tab.addEventListener('click', () => {
                currentMonthIdx = idx;
                renderCalendar();
            });
        });

        if (calApplyBtn) {
            calApplyBtn.addEventListener('click', () => {
                if (calApplyBtn.disabled) return;
                if (datesWrap) {
                    datesWrap.classList.remove('is-open');
                    if (datesTrigger) datesTrigger.setAttribute('aria-expanded', 'false');
                }
            });
        }

        // --- 3. GUESTS STEPPERS ---
        const guestsWrap = document.getElementById('guestsDropdownWrap');
        const guestsTrigger = document.getElementById('guestsDropdownTrigger');
        const guestsTitle = document.getElementById('guestsCurrentTitle');
        const guestsSub = document.getElementById('guestsCurrentSub');
        const guestsFooterSummary = document.getElementById('guestsFooterSummary');
        const guestsApplyBtn = document.getElementById('guestsApplyBtn');
        const guestsHidden = document.getElementById('bookingGuestsHidden');

        const adultsInput = document.getElementById('formAdultsInput');
        const adultsDec = document.getElementById('formAdultsDec');
        const adultsInc = document.getElementById('formAdultsInc');

        const childrenInput = document.getElementById('formChildrenInput');
        const childrenDec = document.getElementById('formChildrenDec');
        const childrenInc = document.getElementById('formChildrenInc');

        function updateGuestsDisplay() {
            let adults = parseInt(adultsInput?.value || '2', 10);
            let children = parseInt(childrenInput?.value || '0', 10);

            if (isNaN(adults) || adults < 1) adults = 1;
            if (adults > 10) adults = 10;
            if (isNaN(children) || children < 0) children = 0;
            if (children > 8) children = 8;

            if (adultsInput) adultsInput.value = adults;
            if (childrenInput) childrenInput.value = children;

            if (adultsDec) adultsDec.disabled = (adults <= 1);
            if (adultsInc) adultsInc.disabled = (adults >= 10);
            if (childrenDec) childrenDec.disabled = (children <= 0);
            if (childrenInc) childrenInc.disabled = (children >= 8);

            const total = adults + children;
            const adultsText = pluralize(adults, 'взрослый', 'взрослых', 'взрослых');
            const totalText = pluralize(total, 'гость', 'гостя', 'гостей');

            let headerTitle = adultsText;
            if (children > 0) {
                const childrenText = pluralize(children, 'ребенок', 'ребенка', 'детей');
                headerTitle = `${adultsText}, ${childrenText}`;
            }

            if (guestsTitle) guestsTitle.textContent = headerTitle;
            if (guestsSub) guestsSub.textContent = `Всего: ${totalText}`;
            if (guestsFooterSummary) guestsFooterSummary.textContent = `Всего: ${totalText}`;
            if (guestsHidden) {
                const childrenText = children > 0 ? pluralize(children, 'ребенок', 'ребенка', 'детей') : '';
                guestsHidden.value = children > 0
                    ? `${totalText} (${adultsText}, ${childrenText})`
                    : `${totalText} (${adultsText})`;
            }
        }

        if (adultsDec) {
            adultsDec.addEventListener('click', () => {
                let v = parseInt(adultsInput.value, 10) || 2;
                if (v > 1) { adultsInput.value = v - 1; updateGuestsDisplay(); }
            });
        }
        if (adultsInc) {
            adultsInc.addEventListener('click', () => {
                let v = parseInt(adultsInput.value, 10) || 2;
                if (v < 10) { adultsInput.value = v + 1; updateGuestsDisplay(); }
            });
        }

        if (childrenDec) {
            childrenDec.addEventListener('click', () => {
                let v = parseInt(childrenInput.value, 10) || 0;
                if (v > 0) { childrenInput.value = v - 1; updateGuestsDisplay(); }
            });
        }
        if (childrenInc) {
            childrenInc.addEventListener('click', () => {
                let v = parseInt(childrenInput.value, 10) || 0;
                if (v < 8) { childrenInput.value = v + 1; updateGuestsDisplay(); }
            });
        }

        if (adultsInput) adultsInput.addEventListener('change', updateGuestsDisplay);
        if (childrenInput) childrenInput.addEventListener('change', updateGuestsDisplay);

        if (guestsApplyBtn) {
            guestsApplyBtn.addEventListener('click', () => {
                if (guestsWrap) {
                    guestsWrap.classList.remove('is-open');
                    if (guestsTrigger) guestsTrigger.setAttribute('aria-expanded', 'false');
                }
            });
        }

        // --- 4. CONTACT METHOD SWITCHER (PHONE / EMAIL / MAX) ---
        const methodWrap = document.getElementById('methodDropdownWrap');
        const methodTrigger = document.getElementById('methodDropdownTrigger');
        const methodTitle = document.getElementById('methodCurrentTitle');
        const methodIcon = document.getElementById('methodCurrentIcon');
        const bookingMethodInput = document.getElementById('bookingMethodInput');
        const methodOptions = form.querySelectorAll('#methodPopover .form-popover__option');
        const bookingContactLabel = document.getElementById('bookingContactLabel');
        const bookingPhone = document.getElementById('bookingPhone');
        const bookingMaxBtn = document.getElementById('bookingMaxBtn');

        function selectMethod(val, title) {
            if (methodTitle && title) methodTitle.textContent = title;
            if (bookingMethodInput && val) bookingMethodInput.value = val;

            methodOptions.forEach(opt => {
                if (opt.dataset.val === val) {
                    opt.classList.add('is-selected');
                    const optIcon = opt.querySelector('.form-popover__opt-icon');
                    if (optIcon && methodIcon) {
                        methodIcon.innerHTML = optIcon.innerHTML;
                    }
                } else {
                    opt.classList.remove('is-selected');
                }
            });

            if (methodWrap) {
                methodWrap.classList.remove('is-open');
                if (methodTrigger) methodTrigger.setAttribute('aria-expanded', 'false');
            }

            if (!bookingContactLabel || !bookingPhone || !bookingMaxBtn) return;

            if (val === 'max') {
                bookingContactLabel.textContent = 'Мессенджер MAX';
                bookingPhone.classList.add('is-hidden');
                bookingPhone.removeAttribute('required');
                bookingMaxBtn.classList.remove('is-hidden');
            } else {
                bookingMaxBtn.classList.add('is-hidden');
                bookingPhone.classList.remove('is-hidden');
                bookingPhone.setAttribute('required', 'required');

                if (val === 'email') {
                    bookingContactLabel.textContent = 'Ваш Email';
                    bookingPhone.type = 'email';
                    bookingPhone.placeholder = 'ivan@example.ru';
                } else {
                    // Телефон
                    bookingContactLabel.textContent = 'Телефон';
                    bookingPhone.type = 'tel';
                    bookingPhone.placeholder = '+7 (___) ___-__-__';
                }
            }
        }

        methodOptions.forEach(opt => {
            opt.addEventListener('click', () => {
                selectMethod(opt.dataset.val, opt.dataset.title);
            });
        });

        // --- 5. FORM SUBMISSION & FEEDBACK ---
        const toast = document.getElementById('toastNotice');
        function showToast(title, message) {
            if (!toast) return;
            const titleEl = toast.querySelector('.toast-notice__title');
            const textEl = toast.querySelector('.toast-notice__text');
            if (titleEl && title) titleEl.textContent = title;
            if (textEl && message) textEl.textContent = message;

            toast.classList.add('is-active');
            setTimeout(() => {
                toast.classList.remove('is-active');
            }, 6000);
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const submitBtn = document.getElementById('bookingSubmitBtn');
            const nameInput = document.getElementById('bookingName');
            const commentInput = document.getElementById('bookingComment');

            // When MAX is selected, redirect directly to MAX and also create a lead in CRM
            if (bookingMethodInput && bookingMethodInput.value === 'max') {
                const maxUrl = (bookingMaxBtn && bookingMaxBtn.getAttribute('href')) || 'https://max.ru/id2203004205_bot';
                window.open(maxUrl, '_blank', 'noopener,noreferrer');

                if (window.BigAltayCRM) {
                    try {
                        await window.BigAltayCRM.submitLead(window.BigAltayCRM.leadFromBookingForm(form));
                    } catch (err) {
                        console.error('[Bitrix24] заявка MAX не создана:', err);
                    }
                }
                return;
            }

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Отправка заявки...';
            }

            let leadId = null;
            if (window.BigAltayCRM) {
                try {
                    leadId = await window.BigAltayCRM.submitLead(window.BigAltayCRM.leadFromBookingForm(form));
                } catch (err) {
                    console.error('[Bitrix24] ошибка создания лида:', err);
                }
            }

            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Оставить заявку';
            }

            if (leadId !== null) {
                if (nameInput) nameInput.value = '';
                if (bookingPhone) bookingPhone.value = '';
                if (commentInput) commentInput.value = '';
                form.reset();

                showToast(
                    'Заявка на бронирование принята!',
                    'Специалист по курорту Белокуриха свяжется с вами в течение 10 минут с деталями по новогодним номерам.'
                );
            } else {
                showToast(
                    'Не удалось отправить заявку',
                    'Попробуйте ещё раз или позвоните нам: 8 (800) 500-07-34.'
                );
            }
        });

        // Initialize state
        renderCalendar();
        updateCalendarDisplay();
        updateGuestsDisplay();
    }

    /* ------------------------------------------------------------------------
       05. ACCORDION FAQ (CLEAN, ACCESSIBLE, ZERO ICONS)
       ------------------------------------------------------------------------ */
    function initAccordion() {
        const items = document.querySelectorAll('.faq-item');
        if (!items.length) return;

        items.forEach(item => {
            const trigger = item.querySelector('.faq-item__trigger');
            const content = item.querySelector('.faq-item__content');

            if (!trigger || !content) return;

            trigger.addEventListener('click', () => {
                const isOpen = item.classList.contains('is-open');

                // Close other opened items for clean minimalist flow
                items.forEach(otherItem => {
                    if (otherItem !== item && otherItem.classList.contains('is-open')) {
                        otherItem.classList.remove('is-open');
                        otherItem.querySelector('.faq-item__trigger')?.setAttribute('aria-expanded', 'false');
                        const otherContent = otherItem.querySelector('.faq-item__content');
                        if (otherContent) otherContent.style.maxHeight = null;
                    }
                });

                if (isOpen) {
                    item.classList.remove('is-open');
                    trigger.setAttribute('aria-expanded', 'false');
                    content.style.maxHeight = null;
                } else {
                    item.classList.add('is-open');
                    trigger.setAttribute('aria-expanded', 'true');
                    content.style.maxHeight = content.scrollHeight + 'px';
                }
            });
        });
    }

    /* ------------------------------------------------------------------------
       INITIALIZATION ENTRY POINT
       ------------------------------------------------------------------------ */
    document.addEventListener('DOMContentLoaded', () => {
        initSnowCanvas();
        initHeader();
        initBookingForm();
        initQuickConsultForm();
        initProgramTabs();
        initAccordion();
    });

    /* ------------------------------------------------------------------------
       04c. NEW YEAR PROGRAM TABS (SANATORIUM SWITCHER)
       ------------------------------------------------------------------------ */
    function initProgramTabs() {
        const tabButtons = document.querySelectorAll('.programs-tab[data-program-tab]');
        const panels = document.querySelectorAll('.programs-panel');
        if (!tabButtons.length || !panels.length) return;

        function switchProgramTab(targetKey) {
            if (!targetKey) return;

            // Update tab states
            tabButtons.forEach(b => {
                const isActive = (b.dataset.programTab === targetKey);
                b.classList.toggle('is-active', isActive);
                b.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });

            // Update tab panels
            panels.forEach(panel => {
                const isMatch = panel.id.toLowerCase().includes(targetKey.toLowerCase());
                if (isMatch) {
                    panel.hidden = false;
                    panel.classList.add('is-active');
                } else {
                    panel.hidden = true;
                    panel.classList.remove('is-active');
                }
            });
        }

        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetKey = btn.dataset.programTab;
                switchProgramTab(targetKey);
            });

            // Keyboard navigation (ArrowLeft / ArrowRight)
            btn.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const tabsArray = Array.from(tabButtons);
                    const currentIndex = tabsArray.indexOf(btn);
                    const nextIndex = e.key === 'ArrowRight'
                        ? (currentIndex + 1) % tabsArray.length
                        : (currentIndex - 1 + tabsArray.length) % tabsArray.length;
                    tabsArray[nextIndex].focus();
                    tabsArray[nextIndex].click();
                }
            });
        });

        // Wire up buttons from sanatorium cards: "Смотреть новогодние программы"
        const cardProgramBtns = document.querySelectorAll('.sanatorium-programs-btn[data-sanatorium-program-tab]');
        cardProgramBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const targetTab = btn.dataset.sanatoriumProgramTab;
                if (!targetTab) return;

                switchProgramTab(targetTab);

                // Smooth scroll to programs section with offset for sticky header
                const programsSection = document.getElementById('programs');
                if (programsSection) {
                    const headerHeight = document.querySelector('.site-header')?.offsetHeight || 72;
                    const sectionTop = programsSection.getBoundingClientRect().top + window.pageYOffset;
                    window.scrollTo({
                        top: sectionTop - headerHeight - 16,
                        behavior: 'smooth'
                    });
                }
            });
        });
    }

    /* ------------------------------------------------------------------------
       04b. QUICK CONSULTATION FORM
       ------------------------------------------------------------------------ */
    function initQuickConsultForm() {
        const form = document.getElementById('quickConsultForm');
        if (!form) return;

        const phoneInput = document.getElementById('quickConsultPhone');
        const submitBtn = document.getElementById('quickConsultSubmitBtn');
        const toast = document.getElementById('toastNotice');

        function showToast(title, message) {
            if (!toast) return;
            const titleEl = toast.querySelector('.toast-notice__title');
            const textEl = toast.querySelector('.toast-notice__text');
            if (titleEl && title) titleEl.textContent = title;
            if (textEl && message) textEl.textContent = message;

            toast.classList.add('is-active');
            setTimeout(() => {
                toast.classList.remove('is-active');
            }, 6000);
        }

        function formatPhone(input) {
            input.addEventListener('input', () => {
                let val = input.value.replace(/\D/g, '');
                if (!val) {
                    input.value = '';
                    return;
                }
                if (['7', '8', '9'].includes(val[0])) {
                    if (val[0] === '9') val = '7' + val;
                    let firstChar = '+7';
                    let formatted = firstChar + ' ';
                    if (val.length > 1) {
                        formatted += '(' + val.substring(1, 4);
                    }
                    if (val.length >= 5) {
                        formatted += ') ' + val.substring(4, 7);
                    }
                    if (val.length >= 8) {
                        formatted += '-' + val.substring(7, 9);
                    }
                    if (val.length >= 10) {
                        formatted += '-' + val.substring(9, 11);
                    }
                    input.value = formatted;
                } else {
                    input.value = '+' + val.substring(0, 15);
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && input.value.length <= 4) {
                    input.value = '';
                }
            });
        }

        if (phoneInput) {
            formatPhone(phoneInput);
        }

        const mainPhone = document.getElementById('bookingPhone');
        if (mainPhone) {
            formatPhone(mainPhone);
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!phoneInput || !phoneInput.value.trim()) {
                if (phoneInput) phoneInput.focus();
                return;
            }

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Отправка...';
            }

            let leadId = null;
            if (window.BigAltayCRM) {
                try {
                    leadId = await window.BigAltayCRM.submitLead(
                        window.BigAltayCRM.leadFromQuickConsultForm(phoneInput.value.trim())
                    );
                } catch (err) {
                    console.error('[Bitrix24] ошибка создания лида (консультация):', err);
                }
            }

            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Получить консультацию';
            }

            if (leadId !== null) {
                if (phoneInput) phoneInput.value = '';

                showToast(
                    'Заявка на консультацию принята!',
                    'Наш специалист свяжется с вами для предоставления консультации.'
                );
            } else {
                showToast(
                    'Не удалось отправить заявку',
                    'Попробуйте ещё раз или позвоните нам: 8 (800) 500-07-34.'
                );
            }
        });
    }

})();
