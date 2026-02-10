/* =========================================================
   SEU Student Services PWA (Static)
   - Installable PWA (manifest + service worker)
   - Per-page share (Web Share API + fallbacks)
   - LocalStorage: حفظ بيانات المستخدم والطلبات
   - فاتورة + رسالة واتساب/تليجرام + جدول متابعة (قابل للطباعة PDF)
   ========================================================= */

(function(){
  'use strict';

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const STATE_KEY = 'seu_ss_state_v1';
  const nowISO = () => new Date().toISOString();

  // ---------- Toast ----------
  function toast(msg){
    const t = $('#toast');
    if(!t) return;
    t.textContent = msg;
    t.classList.add('show');
    window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(()=>t.classList.remove('show'), 2600);
  }

  // ---------- Local storage helpers ----------
  function loadState(){
    try{
      const raw = localStorage.getItem(STATE_KEY);
      return raw ? JSON.parse(raw) : {};
    }catch(e){ return {}; }
  }
  function saveState(patch){
    const st = loadState();
    const next = Object.assign({}, st, patch, {updatedAt: nowISO()});
    localStorage.setItem(STATE_KEY, JSON.stringify(next));
    return next;
  }

  // ---------- PWA registration ----------
  async function registerSW(){
    if(!('serviceWorker' in navigator)) return;
    try{
      await navigator.serviceWorker.register('./sw.js', {scope: './'});
    }catch(e){
      // silent
    }
  }

  // Install prompt (A2HS)
  let deferredPrompt = null;
  function wireInstall(){
    const btn = $('#btnInstall');
    if(!btn) return;
    btn.style.display = 'none';

    window.addEventListener('beforeinstallprompt', (e)=>{
      e.preventDefault();
      deferredPrompt = e;
      btn.style.display = 'inline-flex';
    });

    btn.addEventListener('click', async ()=>{
      if(!deferredPrompt) return;
      deferredPrompt.prompt();
      try{ await deferredPrompt.userChoice; }catch(_){}
      deferredPrompt = null;
      btn.style.display = 'none';
    });
  }

  // ---------- Bottom nav active ----------
  function setActiveNav(){
    const page = document.body.getAttribute('data-page');
    $$('.navitem').forEach(a=>{
      const id = a.getAttribute('data-nav');
      if(id && page && id === page) a.classList.add('active');
    });
  }

  // ---------- Share ----------
  function getShareMeta(){
    const title = $('meta[name="share:title"]')?.content || document.title;
    const text  = $('meta[name="share:text"]')?.content || '';
    const url   = $('meta[name="share:url"]')?.content || window.location.href;
    return {title, text, url};
  }

  async function copyText(text){
    try{
      await navigator.clipboard.writeText(text);
      toast('تم النسخ ✅');
      return true;
    }catch(e){
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try{
        document.execCommand('copy');
        toast('تم النسخ ✅');
        return true;
      }catch(_){
        toast('تعذر النسخ تلقائيًا. انسخ يدويًا.');
        return false;
      }finally{
        ta.remove();
      }
    }
  }

  async function doShare(){
    const s = getShareMeta();
    const payload = { title: s.title, text: s.text, url: s.url };

    if(navigator.share){
      try{
        await navigator.share(payload);
        return;
      }catch(e){
        // user cancelled or unsupported
      }
    }

    // fallback: copy
    const fallback = `${s.title}\n\n${s.text}\n\n${s.url}`;
    await copyText(fallback);
  }

  function wireShare(){
    const btn = $('#btnShare');
    if(btn) btn.addEventListener('click', doShare);

    // also wire any element with data-action="share"
    $$('[data-action="share"]').forEach(el=>{
      el.addEventListener('click', doShare);
    });
  }

  // ---------- WhatsApp/Telegram helpers ----------
  function waLink(numberE164NoPlus, message){
    // WhatsApp click-to-chat uses wa.me/NUMBER?text=... (encodeURIComponent for safety)
    // (common pattern; see docs from various sources)
    const text = encodeURIComponent(message);
    return `https://wa.me/${numberE164NoPlus}?text=${text}`;
  }
  function tgShareLink(url, text){
    // Telegram share widget pattern: https://t.me/share/url?url=...&text=...
    return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  }
  function tgBotLink(botUsername, startPayload){
    // Telegram deep link for bots: https://t.me/<bot>?start=<payload>
    // NOTE: payload length is limited by Telegram clients; keep it short.
    return `https://t.me/${botUsername}?start=${encodeURIComponent(startPayload)}`;
  }

  // ---------- Pricing / Invoice ----------
  const PRICING = {
    currency: 'SAR',
    termCoaching: {
      title: 'اشتراك متابعة ترم كامل (دعم دراسي + جلسات شرح + تذكيرات)',
      basePerCourse: 250,
      practicalExtra: 50, // مادة عملية
      maxCoursesForBundle: 6,
      bundleDiscountPct: 8 // خصم إضافي عند 5+ مواد (غير خصم الدفع الكامل)
    },
    individual: {
      title: 'خدمات فردية حسب الطلب',
      items: [
        {id:'session',  name:'جلسة شرح/مراجعة (60 دقيقة)', price: 120},
        {id:'project',  name:'مراجعة مشروع/عرض (تحسين وتنظيم)', price: 220},
        {id:'writing',  name:'تدقيق لغوي وتنسيق بحث/تقرير (بدون كتابة عن الطالب)', price: 180},
        {id:'tech',     name:'دعم تقني (Blackboard / Banner / كتب إلكترونية)', price: 90},
      ]
    },
    payFullDiscountPct: 10
  };

  function money(n){
    const v = Number(n || 0);
    return new Intl.NumberFormat('ar-SA', {minimumFractionDigits: 0, maximumFractionDigits: 2}).format(v);
  }

  function getFormData(form){
    const fd = new FormData(form);
    const obj = {};
    fd.forEach((v,k)=>{
      if(obj[k]){
        if(Array.isArray(obj[k])) obj[k].push(v);
        else obj[k] = [obj[k], v];
      }else obj[k]=v;
    });
    return obj;
  }

  function normalizeCourses(raw){
    if(!raw) return [];
    const lines = String(raw).split('\n').map(s=>s.trim()).filter(Boolean);
    // allow comma-separated too
    const out = [];
    lines.forEach(line=>{
      line.split(',').map(s=>s.trim()).filter(Boolean).forEach(x=>out.push(x));
    });
    return out.slice(0, 12);
  }

  function calcInvoice(data){
    const invoice = {
      id: `SS-${Math.random().toString(36).slice(2,7).toUpperCase()}-${Date.now().toString().slice(-5)}`,
      createdAt: new Date().toLocaleString('ar-SA'),
      currency: PRICING.currency,
      lines: [],
      totals: { subtotal: 0, discount: 0, total: 0 },
      meta: {
        serviceType: data.serviceType || '',
        paymentPlan: data.paymentPlan || '',
        payNow: data.payNow || '',
        payRemaining: data.payRemaining || '',
      }
    };

    let subtotal = 0;

    if(data.serviceType === 'term'){
      const courses = normalizeCourses(data.coursesText);
      const practicalCount = Number(data.practicalCount || 0);
      const courseCount = courses.length || Number(data.courseCount || 0) || 1;

      const base = PRICING.termCoaching.basePerCourse * courseCount;
      const practicalExtra = PRICING.termCoaching.practicalExtra * practicalCount;

      invoice.lines.push({
        name: PRICING.termCoaching.title,
        qty: courseCount,
        unit: PRICING.termCoaching.basePerCourse,
        total: base
      });

      if(practicalCount > 0){
        invoice.lines.push({
          name: 'إضافة مواد عملية (زيادة متابعة)',
          qty: practicalCount,
          unit: PRICING.termCoaching.practicalExtra,
          total: practicalExtra
        });
      }

      subtotal = base + practicalExtra;

      // bundle discount if 5+ courses
      if(courseCount >= 5){
        const extraDisc = subtotal * (PRICING.termCoaching.bundleDiscountPct/100);
        invoice.lines.push({name:`خصم باقة (≥ 5 مواد)`, qty: 1, unit: -extraDisc, total: -extraDisc});
        subtotal -= extraDisc;
      }

      // pay full discount only if user chooses
      if(data.paymentPlan === 'full'){
        const disc = subtotal * (PRICING.payFullDiscountPct/100);
        invoice.lines.push({name:`خصم الدفع الكامل (${PRICING.payFullDiscountPct}%)`, qty: 1, unit: -disc, total: -disc});
        invoice.totals.discount += disc;
        subtotal -= disc;
      }
    }

    if(data.serviceType === 'individual'){
      const selected = Array.isArray(data.individualItems) ? data.individualItems : (data.individualItems ? [data.individualItems] : []);
      const itemsById = Object.fromEntries(PRICING.individual.items.map(i=>[i.id,i]));
      selected.forEach(id=>{
        const it = itemsById[id];
        if(!it) return;
        invoice.lines.push({name: it.name, qty: 1, unit: it.price, total: it.price});
        subtotal += it.price;
      });
    }

    invoice.totals.subtotal = subtotal;
    invoice.totals.total = Math.max(0, subtotal);
    return invoice;
  }

  function renderInvoice(invoice){
    const wrap = $('#invoiceWrap');
    if(!wrap) return;

    const rows = invoice.lines.map(l=>{
      const qty = l.qty ?? 1;
      const unit = l.unit ?? l.total;
      const total = l.total ?? (qty*unit);
      return `<tr>
        <td>${escapeHtml(l.name)}</td>
        <td>${qty}</td>
        <td>${money(unit)} ${invoice.currency}</td>
        <td><b>${money(total)} ${invoice.currency}</b></td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `
      <div class="card" id="invoiceCard">
        <div class="pills">
          <span class="pill">رقم الفاتورة: <b>${escapeHtml(invoice.id)}</b></span>
          <span class="pill">التاريخ: ${escapeHtml(invoice.createdAt)}</span>
          <span class="pill">العملة: ${escapeHtml(invoice.currency)}</span>
        </div>

        <hr class="sep">

        <table class="table">
          <thead>
            <tr>
              <th>البند</th>
              <th>الكمية</th>
              <th>سعر الوحدة</th>
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="4">لم يتم اختيار أي بنود.</td></tr>`}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="3">الإجمالي النهائي</th>
              <th><b>${money(invoice.totals.total)} ${invoice.currency}</b></th>
            </tr>
          </tfoot>
        </table>

        <hr class="sep">

        <div class="notice good">
          <b>ملاحظة الثقة والالتزام:</b>
          هذه المنصّة مخصّصة <b>للدعم الدراسي، الشرح، المتابعة، والتجهيز</b> بما يراعي نزاهة الجامعة وسياساتها.
          <br>
          <span class="muted">الطالب مسؤول عن تسليم أعماله عبر أنظمة الجامعة.</span>
        </div>

        <div class="row" style="margin-top:12px">
          <div>
            <button class="btn primary block" id="btnCreatePlan">إنشاء جدول متابعة (قبل تأكيد الاشتراك)</button>
            <div class="muted" style="margin-top:6px">سيتم حفظ بياناتك تلقائيًا داخل التطبيق.</div>
          </div>
          <div>
            <button class="btn secondary block" id="btnCopyInvoice">نسخ تفاصيل الفاتورة</button>
            <div class="muted" style="margin-top:6px">يمكنك إرسالها مباشرة للواتساب/تليجرام.</div>
          </div>
        </div>

        <div class="row" style="margin-top:12px">
          <a class="btn block" id="btnOpenWhatsApp" href="#" target="_blank" rel="noopener">فتح واتساب برسالة جاهزة</a>
          <a class="btn block" id="btnOpenTelegram" href="#" target="_blank" rel="noopener">فتح تليجرام برسالة جاهزة</a>
        </div>
      </div>
    `;

    // Wire actions
    const btnCopy = $('#btnCopyInvoice');
    if(btnCopy){
      btnCopy.addEventListener('click', async ()=>{
        const msg = buildClientMessage(invoice, loadState().lastOrderForm || {});
        await copyText(msg);
      });
    }

    const btnPlan = $('#btnCreatePlan');
    if(btnPlan){
      btnPlan.addEventListener('click', ()=>{
        // Save invoice then go dashboard
        saveState({ lastInvoice: invoice });
        window.location.href = './dashboard.html';
      });
    }

    // Wire WhatsApp + Telegram links
    const wa = $('#btnOpenWhatsApp');
    const tg = $('#btnOpenTelegram');
    const msg = buildClientMessage(invoice, loadState().lastOrderForm || {});
    const url = window.location.href;

    if(wa) wa.href = waLink('966533940866', msg);
    if(tg) tg.href = tgShareLink(url, msg);
  }

  function escapeHtml(str){
    return String(str ?? '').replace(/[&<>"']/g, s=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[s]);
  }

  function buildBankBlock(){
    return [
      '🔷 *للتحويل عبر حساباتنا البنكية:*',
      '',
      '- **🏦 بنك الانماء**',
      `رقم الحساب : 68206067557000`,
      `الايبان : SA4905000068206067557000`,
      '',
      '🟢 *الاسم : مؤسسة كريتيفا جلوبال لتقنية المعلومات*',
      '',
      '*وصوّر/ي الإيصال عند إتمام التحويل.*',
    ].join('\n');
  }

  function buildClientMessage(invoice, form){
    const name = form.fullName || 'طالب/ـة';
    const phone = form.phone || '';
    const telegram = form.telegram || '';
    const serviceLabel = (form.serviceType === 'term') ? 'اشتراك متابعة ترم كامل' : 'خدمة فردية';
    const uni = form.uniId ? `الرقم الجامعي: ${form.uniId}` : '';
    const college = form.college ? `الكلية: ${form.college}` : '';
    const major = form.major ? `التخصص: ${form.major}` : '';
    const courses = normalizeCourses(form.coursesText || '').map(c=>`- ${c}`).join('\n');
    const total = `${money(invoice.totals.total)} ${invoice.currency}`;
    const payPlan = (form.paymentPlan === 'full') ? 'دفع كامل' : (form.paymentPlan === 'installments' ? 'أقساط' : '');
    const payLine = payPlan ? `نظام الدفع: ${payPlan}` : '';

    const scheduleLine = '✅ تم تجهيز *جدول المتابعة* داخل التطبيق (سأقوم بتحميله وإرساله).';

    const msg = [
      `السلام عليكم،`,
      `أنا ${name}.`,
      ...(phone ? [`واتساب: ${phone}`] : []),
      ...(telegram ? [`تليجرام: @${telegram.replace('@','')}`] : []),
      ...(uni ? [uni] : []),
      ...(college ? [college] : []),
      ...(major ? [major] : []),
      '',
      `🧾 *طلب خدمة عبر الموقع*`,
      `نوع الخدمة: *${serviceLabel}*`,
      ...(courses ? [`المواد/المقررات:\n${courses}`] : []),
      ...(payLine ? [payLine] : []),
      '',
      `رقم الفاتورة: *${invoice.id}*`,
      `الإجمالي: *${total}*`,
      '',
      'أؤكد رغبتي بالاشتراك، وسيتم التحويل حسب اختيار الدفع. وفي حال كان أقساط أتعهد بتحويل الرسوم المتبقية في مواعيدها.',
      '',
      scheduleLine,
      '',
      buildBankBlock(),
      '',
      '📌 بعد التحويل: أرسل/ي صورة الإيصال + اسم المحول + وقت التحويل.',
      '',
      'شاكرين لكم 🌿'
    ].join('\n');

    return msg;
  }

  function wireOrderForm(){
    const form = $('#orderForm');
    if(!form) return;

    const st = loadState();
    // Prefill from profile (if user saved on home page)
    if(st.profile){
      ['fullName','phone','telegram','uniId'].forEach((k)=>{
        const el = form.elements[k];
        if(el && !el.value && st.profile[k]) el.value = st.profile[k];
      });
    }

    // Prefill if exists
    if(st.lastOrderForm){
      Object.entries(st.lastOrderForm).forEach(([k,v])=>{
        const el = form.elements[k];
        if(!el) return;
        if(el.type === 'checkbox' || el.type === 'radio') return;
        el.value = v;
      });

      // For multi-select checkboxes (individualItems)
      const items = st.lastOrderForm.individualItems;
      if(items){
        const arr = Array.isArray(items) ? items : [items];
        arr.forEach(id=>{
          const cb = form.querySelector(`input[name="individualItems"][value="${CSS.escape(id)}"]`);
          if(cb) cb.checked = true;
        });
      }
    }

    // Toggle sections
    const termSection = $('#termSection');
    const indivSection = $('#individualSection');

    function refreshSections(){
      const type = form.elements.serviceType.value;
      if(termSection) termSection.style.display = (type === 'term') ? 'block' : 'none';
      if(indivSection) indivSection.style.display = (type === 'individual') ? 'block' : 'none';
    }
    form.elements.serviceType.addEventListener('change', refreshSections);
    refreshSections();

    // Auto save on change
    form.addEventListener('input', ()=>{
      const data = getFormData(form);
      saveState({ lastOrderForm: data });
    });

    form.addEventListener('submit', (e)=>{
      e.preventDefault();
      const data = getFormData(form);
      saveState({ lastOrderForm: data });

      const invoice = calcInvoice(data);
      saveState({ lastInvoice: invoice });

      renderInvoice(invoice);
      toast('تم إنشاء الفاتورة ✅');
      // scroll
      $('#invoiceWrap')?.scrollIntoView({behavior:'smooth', block:'start'});
    });

    // Render pricing list
    const indivList = $('#indivItems');
    if(indivList){
      indivList.innerHTML = PRICING.individual.items.map(it=>`
        <label style="display:flex;gap:10px;align-items:flex-start;margin:10px 0">
          <input type="checkbox" name="individualItems" value="${it.id}" style="width:auto;margin-top:4px">
          <span>
            <b>${escapeHtml(it.name)}</b>
            <div class="muted">${money(it.price)} ${PRICING.currency}</div>
          </span>
        </label>
      `).join('');
    }
  }

  // ---------- Dashboard / Plan ----------
  function wireDashboard(){
    const page = document.body.getAttribute('data-page');
    if(page !== 'dashboard') return;

    const st = loadState();
    const inv = st.lastInvoice;
    const form = st.lastOrderForm || {};

    const summary = $('#dashSummary');
    if(summary){
      if(!inv){
        summary.innerHTML = `<div class="notice">لا توجد فاتورة محفوظة بعد. اذهب إلى صفحة الخدمات وأنشئ فاتورتك أولاً.</div>`;
      }else{
        const courses = normalizeCourses(form.coursesText || '');
        summary.innerHTML = `
          <div class="card">
            <h2>ملخص الطلب</h2>
            <div class="pills">
              <span class="pill">الفاتورة: <b>${escapeHtml(inv.id)}</b></span>
              <span class="pill">الإجمالي: <b>${money(inv.totals.total)} ${escapeHtml(inv.currency)}</b></span>
              <span class="pill">نوع الخدمة: <b>${form.serviceType === 'term' ? 'ترم كامل' : 'فردية'}</b></span>
            </div>
            <hr class="sep">
            <div class="row">
              <div>
                <label>بداية الترم</label>
                <input id="termStart" type="date" value="${escapeHtml(form.termStart || '')}">
              </div>
              <div>
                <label>عدد الأسابيع</label>
                <input id="termWeeks" type="number" min="4" max="20" value="${escapeHtml(form.termWeeks || '14')}">
              </div>
            </div>

            <div style="margin-top:12px">
              <label>المقررات (سطر لكل مادة)</label>
              <textarea id="planCourses" placeholder="مثال:\nENG101\nMATH101\nCS140" >${escapeHtml((courses.length? courses.join('\n') : (form.coursesText || '')).trim())}</textarea>
              <div class="muted">يمكنك تعديلها الآن — وسيتم حفظها تلقائيًا.</div>
            </div>

            <div class="row" style="margin-top:12px">
              <button class="btn primary block" id="btnGeneratePlan">توليد جدول المتابعة</button>
              <button class="btn secondary block" id="btnAddCalendar">تحميل تذكير أسبوعي (ملف تقويم .ics)</button>
            </div>

            <div class="row" style="margin-top:12px">
              <button class="btn block" id="btnPrintPlan">حفظ الجدول كـ PDF (طباعة)</button>
              <button class="btn block" id="btnCopyPlanMsg">نسخ رسالة "تم تجهيز الجدول"</button>
            </div>

            <div class="notice" style="margin-top:12px">
              <b>عن الإشعارات الأسبوعية:</b> التطبيق ثابت (بدون خادم)، لذلك أفضل طريقة موثوقة للإشعارات هي
              <b>إضافة تذكير أسبوعي للتقويم</b> (Google/Apple/Outlook).
            </div>
          </div>
        `;
      }
    }

    const planWrap = $('#planWrap');
    function savePlanFields(){
      const termStart = $('#termStart')?.value || '';
      const termWeeks = $('#termWeeks')?.value || '14';
      const coursesText = $('#planCourses')?.value || '';
      saveState({ lastOrderForm: Object.assign({}, form, {termStart, termWeeks, coursesText}) });
    }

    function generatePlan(){
      savePlanFields();
      const st2 = loadState();
      const f = st2.lastOrderForm || {};
      const start = f.termStart ? new Date(f.termStart+'T00:00:00') : null;
      const weeks = Math.max(4, Math.min(20, Number(f.termWeeks || 14)));
      const courses = normalizeCourses(f.coursesText || '');
      const hasCourses = courses.length > 0;

      const title = hasCourses ? courses.join(' • ') : '—';
      const header = `
        <div class="card" id="planCard">
          <h2>جدول المتابعة (نموذج توضيحي)</h2>
          <div class="muted">
            هذا جدول "نموذج" يوضح آلية المتابعة والتنظيم. يمكن تعديله حسب متطلبات كل مقرر وخطة الدكتور/الدكتورة.
          </div>
          <hr class="sep">
          <div class="pills">
            <span class="pill">اسم الطالب/ـة: <b>${escapeHtml(f.fullName || '—')}</b></span>
            <span class="pill">المقررات: <b>${escapeHtml(title)}</b></span>
            <span class="pill">عدد الأسابيع: <b>${weeks}</b></span>
          </div>
          <div class="notice good" style="margin-top:12px">
            <b>طريقة العمل:</b> كل أسبوع يتم تحديث الجدول + إرسال ملخص إنجاز + ضبط أسبوع جديد بالتنسيق مع الطالب/ـة.
          </div>
        </div>
      `;

      const rows = [];
      for(let w=1; w<=weeks; w++){
        const dateLabel = start ? formatWeekRange(start, w) : `الأسبوع ${w}`;
        rows.push(`
          <tr>
            <td><b>${w}</b><div class="muted">${escapeHtml(dateLabel)}</div></td>
            <td>
              <div class="pills">
                <span class="pill">قراءة + تلخيص</span>
                <span class="pill">تدريب أسئلة</span>
                <span class="pill">تسليم قبل الموعد</span>
              </div>
              <div class="muted">ملاحظة: عند وجود كويز/اختبار يضاف هنا حسب التقويم.</div>
            </td>
            <td>
              <ul class="clean">
                <li>جلسة متابعة/شرح (حسب الحاجة)</li>
                <li>مراجعة مخرجات الأسبوع</li>
                <li>تعديل خطة الأسبوع القادم</li>
              </ul>
            </td>
            <td>
              <div class="muted">يرجى إبلاغنا بأي مهام/اختبارات يحددها الدكتور خلال الأسبوع.</div>
            </td>
          </tr>
        `);
      }

      const table = `
        <div class="card" style="margin-top:14px" id="planTableCard">
          <div class="no-print" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between">
            <div class="pills">
              <span class="pill">✅ ملون وقابل للحفظ PDF</span>
              <span class="pill">💡 استخدم زر "طباعة" ثم اختر Save as PDF</span>
            </div>
            <button class="btn small" data-action="share">مشاركة</button>
          </div>

          <table class="table" style="margin-top:12px">
            <thead>
              <tr>
                <th style="width:130px">الأسبوع</th>
                <th>مهام الطالب/ـة</th>
                <th>التزام فريق المتابعة</th>
                <th style="width:240px">ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              ${rows.join('')}
            </tbody>
          </table>

          <hr class="sep">
          <div class="notice">
            <b>مهم:</b> هذا الجدول لا يغني عن الرجوع إلى الخطة الرسمية للمقرر داخل Blackboard والتقويم الأكاديمي.
          </div>
        </div>
      `;

      if(planWrap){
        planWrap.innerHTML = header + table;
        wireShare();
        toast('تم توليد جدول المتابعة ✅');
        planWrap.scrollIntoView({behavior:'smooth', block:'start'});
      }
    }

    function formatWeekRange(startDate, weekIndex){
      const start = new Date(startDate.getTime());
      start.setDate(start.getDate() + (weekIndex-1)*7);
      const end = new Date(start.getTime());
      end.setDate(end.getDate() + 6);
      const fmt = new Intl.DateTimeFormat('ar-SA', {year:'numeric', month:'2-digit', day:'2-digit'});
      return `${fmt.format(start)} → ${fmt.format(end)}`;
    }

    function downloadICS(){
      savePlanFields();
      const st2 = loadState();
      const f = st2.lastOrderForm || {};
      const start = f.termStart ? new Date(f.termStart+'T18:00:00') : new Date();
      const weeks = Math.max(4, Math.min(20, Number(f.termWeeks || 14)));

      // Generate a minimal .ics file (weekly event at 6:00 PM on start date's weekday)
      const dtstamp = toICSDate(new Date());
      const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//SEU Student Services//Plan Reminder//AR',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${cryptoRandomId()}@seu-student-services`,
        `DTSTAMP:${dtstamp}`,
        `SUMMARY:${escapeICS('تذكير أسبوعي: مراجعة إنجاز الدراسة')}`,
        `DESCRIPTION:${escapeICS('تذكير أسبوعي لمراجعة ما تم إنجازه وتحديث جدول المتابعة داخل التطبيق.')}`,
        `DTSTART:${toICSDate(start)}`,
        `DTEND:${toICSDate(addHours(start, 1))}`,
        `RRULE:FREQ=WEEKLY;COUNT=${weeks}`,
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const blob = new Blob([lines], {type:'text/calendar;charset=utf-8'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'تذكير-اسبوعي-خدمات-الطلاب.ics';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('تم تنزيل ملف التقويم ✅');
    }

    function toICSDate(d){
      // YYYYMMDDTHHMMSSZ (UTC)
      const z = new Date(d.getTime());
      const pad = n => String(n).padStart(2,'0');
      return z.getUTCFullYear() + pad(z.getUTCMonth()+1) + pad(z.getUTCDate()) + 'T' +
             pad(z.getUTCHours()) + pad(z.getUTCMinutes()) + pad(z.getUTCSeconds()) + 'Z';
    }
    function addHours(d, h){ return new Date(d.getTime() + h*3600*1000); }
    function escapeICS(s){
      return String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
    }
    function cryptoRandomId(){
      try{
        const arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        return Array.from(arr).map(b=>b.toString(16).padStart(2,'0')).join('');
      }catch(e){
        return Math.random().toString(16).slice(2) + Date.now().toString(16);
      }
    }

    function copyPlanMessage(){
      const st2 = loadState();
      const inv2 = st2.lastInvoice;
      if(!inv2){
        toast('لا توجد فاتورة.');
        return;
      }
      const msg = [
        '✅ تم تجهيز جدول المتابعة من داخل الموقع.',
        'يرجى تحميله بصيغة PDF (زر الطباعة ثم Save as PDF) وإرساله لنا مع الإيصال.',
        `رقم الفاتورة: ${inv2.id}`,
      ].join('\n');
      copyText(msg);
    }

    // Wire buttons (may exist after render)
    document.addEventListener('click', (e)=>{
      const id = e.target?.id;
      if(id === 'btnGeneratePlan') generatePlan();
      if(id === 'btnPrintPlan'){
        // Ensure plan exists (generate if empty)
        if(!$('#planCard')) generatePlan();
        window.print();
      }
      if(id === 'btnAddCalendar') downloadICS();
      if(id === 'btnCopyPlanMsg') copyPlanMessage();
    });
  }

  // ---------- Support page ----------
  function wireSupport(){
    const form = $('#supportForm');
    if(!form) return;

    const st = loadState();
    if(st.profile){
      if(form.elements.fullName && !form.elements.fullName.value) form.elements.fullName.value = st.profile.fullName || '';
      if(form.elements.phone && !form.elements.phone.value) form.elements.phone.value = st.profile.phone || '';
      if(form.elements.telegram && !form.elements.telegram.value) form.elements.telegram.value = st.profile.telegram || '';
    }
    if(st.lastInvoice && form.elements.invoiceId && !form.elements.invoiceId.value){
      form.elements.invoiceId.value = st.lastInvoice.id;
    }

    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const data = getFormData(form);
      const issue = data.issueType || 'استفسار';
      const details = data.details || '';
      const invoiceId = data.invoiceId || (st.lastInvoice?.id || '');

      const msg = [
        '🆘 *نموذج بلاغ/متابعة من الموقع*',
        '',
        `الاسم: ${data.fullName || '—'}`,
        `واتساب: ${data.phone || '—'}`,
        `تليجرام: ${data.telegram ? '@'+String(data.telegram).replace('@','') : '—'}`,
        `رقم الفاتورة: ${invoiceId || '—'}`,
        `نوع المشكلة: *${issue}*`,
        '',
        'تفاصيل إضافية:',
        details || '—',
        '',
        '📌 الرجاء إرفاق صور/سكرين شوت في نفس المحادثة (الإيصال + صور من المحادثة إن وجدت).',
        '',
        '⚠️ تنبيه: فضلاً لا ترسل أكثر من مرة. تكرار الرسائل قد يسبب تأخير في المراجعة.'
      ].join('\n');

      await copyText(msg);

      // Open Telegram bot (start payload short) + Telegram share
      const botUrl = tgBotLink('SEU_Services_SandBot', 'support');
      $('#botLink')?.setAttribute('href', botUrl);
      $('#tgShare')?.setAttribute('href', tgShareLink(window.location.href, msg));
      $('#waSupport')?.setAttribute('href', waLink('966533940866', msg));

      toast('تم تجهيز رسالة البلاغ (انسخها ثم أرسلها) ✅');
      $('#supportActions')?.scrollIntoView({behavior:'smooth', block:'start'});
    });
  }

  // ---------- Profile ----------
  function wireProfile(){
    const form = $('#profileForm');
    if(!form) return;
    const st = loadState();
    if(st.profile){
      Object.entries(st.profile).forEach(([k,v])=>{
        const el = form.elements[k];
        if(el && !el.value) el.value = v;
      });
    }
    form.addEventListener('submit', (e)=>{
      e.preventDefault();
      const data = getFormData(form);
      saveState({ profile: data });
      toast('تم حفظ بياناتك ✅');
    });
  }

  

  // ---------- Catalog (مرحلة/كلية/مقرر) ----------
  async function loadCatalog(){
    const res = await fetch('./assets/data/catalog.json', {cache:'no-cache'});
    if(!res.ok) throw new Error('catalog fetch failed');
    return await res.json();
  }

  function uniq(arr){
    return Array.from(new Set(arr.filter(Boolean)));
  }

  function wireCatalog(){
    const page = document.body.getAttribute('data-page');
    if(page !== 'catalog') return;

    const list = $('#catalogList');
    const search = $('#catalogSearch');
    const collegeSel = $('#catalogCollege');

    if(!list || !search || !collegeSel) return;

    let data = null;
    let courses = [];

    function render(){
      const q = (search.value || '').trim().toLowerCase();
      const college = collegeSel.value || '';
      const filtered = courses.filter(c=>{
        const hay = `${c.code} ${c.name} ${c.stage} ${c.college} ${(c.tags||[]).join(' ')}`.toLowerCase();
        const okQ = !q || hay.includes(q);
        const okC = !college || c.college === college;
        return okQ && okC;
      });

      if(filtered.length === 0){
        list.innerHTML = `<div class="card"><b>لا يوجد نتائج</b><div class="muted">غيّر البحث أو التصفية.</div></div>`;
        return;
      }

      list.innerHTML = filtered.map(c=>`
        <a class="card" href="./course.html?code=${encodeURIComponent(c.code)}" style="text-decoration:none">
          <h2 style="margin-bottom:6px">${escapeHtml(c.name)}</h2>
          <div class="pills">
            <span class="pill">${escapeHtml(c.code)}</span>
            <span class="pill">${escapeHtml(c.college || '')}</span>
            <span class="pill">${escapeHtml(c.stage || '')}</span>
          </div>
          <div class="muted" style="margin-top:10px">${escapeHtml((c.tags||[]).join(' • '))}</div>
        </a>
      `).join('');
    }

    // Load
    loadCatalog().then(d=>{
      data = d;
      courses = (d.courses || []).slice();

      // Populate colleges
      const colleges = uniq(courses.map(c=>c.college)).sort((a,b)=>a.localeCompare(b,'ar'));
      colleges.forEach(c=>{
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        collegeSel.appendChild(opt);
      });

      render();
    }).catch(()=>{
      list.innerHTML = `<div class="notice">تعذر تحميل بيانات الدليل. تأكد من وجود الملف assets/data/catalog.json.</div>`;
    });

    search.addEventListener('input', render);
    collegeSel.addEventListener('change', render);
  }

  function setMeta(name, value){
    const m = document.querySelector(`meta[name="${name}"]`);
    if(m) m.setAttribute('content', value);
  }

  function wireCourse(){
    const page = document.body.getAttribute('data-page');
    if(page !== 'course') return;

    const titleEl = $('#courseTitle');
    const metaEl = $('#courseMeta');
    const tipsEl = $('#courseTips');

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code') || '';

    if(!code){
      if(titleEl) titleEl.textContent = 'صفحة مقرر';
      if(metaEl) metaEl.textContent = 'لم يتم تحديد كود المقرر في الرابط.';
      return;
    }

    loadCatalog().then(d=>{
      const courses = d.courses || [];
      const c = courses.find(x=>String(x.code).toLowerCase() === String(code).toLowerCase());
      if(!c){
        if(titleEl) titleEl.textContent = 'غير موجود';
        if(metaEl) metaEl.textContent = `لم نجد المقرر: ${code}`;
        if(tipsEl) tipsEl.innerHTML = `<li>تحقق من الكود أو ارجع للدليل.</li>`;
        return;
      }

      document.title = `${c.code} | ${c.name}`;
      if(titleEl) titleEl.textContent = `${c.name}`;
      if(metaEl) metaEl.textContent = `${c.code} • ${c.college} • ${c.stage}`;

      // Update share meta so زر المشاركة يختلف حسب المقرر
      setMeta('share:title', `${c.code} — ${c.name}`);
      setMeta('share:text', c.shareText || `نصائح سريعة لمقرر ${c.code} — ${c.name}`);

      if(tipsEl){
        const tips = Array.isArray(c.tips) ? c.tips : [];
        tipsEl.innerHTML = (tips.length ? tips : ['لا توجد نصائح بعد.']).map(t=>`<li>${escapeHtml(t)}</li>`).join('');
      }
    }).catch(()=>{
      if(metaEl) metaEl.textContent = 'تعذر تحميل بيانات المقرر.';
    });
  }

// ---------- Init ----------
  function init(){
    registerSW();
    wireInstall();
    setActiveNav();
    wireShare();
    wireOrderForm();
    wireDashboard();
    wireSupport();
    wireProfile();
    wireCatalog();
    wireCourse();

    // Save basic pageview/time (privacy-friendly)
    const st = loadState();
    const views = Number(st.views || 0) + 1;
    saveState({ views });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
