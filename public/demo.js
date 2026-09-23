// Synthetic demonstration fixtures only; no real customer, tax, banking or contact records.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const appSteps = [
  { title: "Brand profile", note: "Business identity & contacts" },
  { title: "Documents", note: "Compliance & authorization" },
  { title: "Catalogue", note: "Products, content & inventory" },
  { title: "Fulfilment", note: "Orders, delivery & returns" },
  { title: "Review", note: "Confirm and submit" },
];

let currentStep = 0;
let applicationSubmitted = false;
let activeOpsPage = "Overview";

const railItems = [
  ["⌂", "Home"], ["▱", "Commerce"], ["⇄", "Konnect"], ["◫", "OMS"], ["⌁", "Analytics"]
];
const opsPages = ["Overview", "Vendors", "Catalogue", "Inventory", "Orders", "Returns", "Settlements", "Integrations"];

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function setMode(mode) {
  const ops = mode === "ops";
  $("#partner-view").hidden = ops;
  $("#ops-view").hidden = !ops;
  $$(".demo-switch button").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  if (ops) renderOps();
}

function resetPartner() {
  $("#partner-landing").hidden = false;
  $("#application-workspace").hidden = true;
  currentStep = 0;
  applicationSubmitted = false;
}

function startApplication() {
  $("#partner-landing").hidden = true;
  $("#application-workspace").hidden = false;
  renderApplication();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function stepButtons(back = true, label = "Save & continue") {
  return `<div class="form-actions">
    ${back ? `<button class="secondary-action" data-prev>← Back</button>` : `<span></span>`}
    <button class="primary-action" data-next>${label} <span>→</span></button>
  </div>`;
}

const applicationPages = [
  () => `<div class="form-page"><div class="step-kicker">STEP 1 · BRAND PROFILE</div><h1>Tell us about your brand</h1><p class="intro">Introduce your business and primary contacts. These details create your partner profile and remain private to the ATI onboarding team.</p>
    <section class="form-section"><h3>Business identity</h3><div class="form-grid">
      <label class="field-label">Trading name<input value="Maison Élan"></label>
      <label class="field-label">Legal entity<input value="Maison Elan Trading LLC"></label>
      <label class="field-label">Primary category<select><option>Women's fashion</option><option>Beauty</option><option>Home</option></select></label>
      <label class="field-label">Country of registration<input value="United Arab Emirates"></label>
      <label class="field-label">Trade licence number<input value="CN-4893721"></label>
      <label class="field-label">Website<input value="https://maisonelan.example"></label>
    </div></section>
    <section class="form-section"><h3>Primary contact</h3><div class="form-grid">
      <label class="field-label">Full name<input value="Nadia Rahman"></label>
      <label class="field-label">Role<input value="Commercial Director"></label>
      <label class="field-label">Work email<input value="nadia@maisonelan.example"></label>
      <label class="field-label">Mobile number<input value="+971 50 555 0138"></label>
    </div></section>${stepButtons(false)}</div>`,
  () => `<div class="form-page"><div class="step-kicker">STEP 2 · DOCUMENTS</div><h1>Verify your business</h1><p class="intro">Upload the documents ATI needs to validate your company, tax registration, and authority to represent the brand.</p>
    <section class="form-section"><h3>Required documents</h3><div class="upload-box"><b>Drop documents here or browse</b><small>PDF, JPG or PNG · maximum 10 MB per file</small><button class="secondary-action" data-upload style="margin-top:16px">Choose files</button></div>
      <div class="file-row"><span>Trade_Licence_Maison_Elan.pdf</span><span>✓ Verified</span></div>
      <div class="file-row"><span>VAT_Certificate_UAE.pdf</span><span>✓ Verified</span></div>
      <div class="file-row"><span>Brand_Authorisation_Letter.pdf</span><span>✓ Uploaded</span></div>
    </section>
    <section class="form-section"><h3>Tax and settlement profile</h3><div class="form-grid"><label class="field-label">TRN<input value="DEMO-TRN-NOT-VALID"></label><label class="field-label">Settlement currency<select><option>AED · UAE Dirham</option><option>SAR · Saudi Riyal</option><option>KWD · Kuwaiti Dinar</option></select></label><label class="field-label full">Registered address<textarea rows="3">Dubai Design District, Building 4, Dubai, UAE</textarea></label></div></section>${stepButtons()}</div>`,
  () => `<div class="form-page"><div class="step-kicker">STEP 3 · CATALOGUE</div><h1>Connect your products</h1><p class="intro">Choose how you will share product content, images, prices and stock. Our team will map it to the Bloomingdale's taxonomy before anything is published.</p>
    <section class="form-section"><h3>Catalogue connection</h3><div class="choice-grid"><button class="choice-card selected"><b>Spreadsheet upload</b><small>Start with the ATI product template</small></button><button class="choice-card"><b>API connection</b><small>Automate catalogue and inventory feeds</small></button><button class="choice-card"><b>SFTP feed</b><small>Schedule structured file imports</small></button></div></section>
    <section class="form-section"><h3>Preview · 24 products detected</h3><div class="catalog-preview"><div class="catalog-header"><span>PRODUCT</span><span>SKU</span><span>PRICE</span><span>READINESS</span></div>
      <div class="catalog-row"><span class="catalog-product"><i class="product-swatch"></i><b>Sculpted Crepe Dress</b></span><span>ME-DR-104</span><span>AED 1,850</span><span class="status-pill green">READY</span></div>
      <div class="catalog-row"><span class="catalog-product"><i class="product-swatch two"></i><b>Draped Silk Blouse</b></span><span>ME-BL-208</span><span>AED 980</span><span class="status-pill amber">2 ISSUES</span></div>
    </div><p style="font-size:11px;color:#777">AI PIM has mapped 94% of attributes. Two Arabic descriptions and one image crop require attention.</p></section>
    <section class="form-section"><h3>Inventory source</h3><div class="form-grid"><label class="field-label">Update method<select><option>Near real-time API</option><option>SFTP every 15 minutes</option><option>Manual upload</option></select></label><label class="field-label">Safety stock buffer<select><option>2 units per location</option><option>5 units per location</option><option>No buffer</option></select></label></div></section>${stepButtons()}</div>`,
  () => `<div class="form-page"><div class="step-kicker">STEP 4 · FULFILMENT</div><h1>Design your operating model</h1><p class="intro">Tell us where orders will be fulfilled and how returns should flow. ATI remains merchant of record and owns the customer experience.</p>
    <section class="form-section"><h3>Fulfilment source</h3><div class="choice-grid"><button class="choice-card selected"><b>Brand fulfilled</b><small>Dispatch from your store or warehouse</small></button><button class="choice-card"><b>ATI warehouse</b><small>Stock is held and fulfilled by ATI</small></button><button class="choice-card"><b>Hybrid</b><small>Route dynamically by inventory and SLA</small></button></div></section>
    <section class="form-section"><h3>Order and delivery commitments</h3><div class="form-grid"><label class="field-label">Order confirmation SLA<select><option>Within 30 minutes</option><option>Within 1 hour</option></select></label><label class="field-label">Dispatch SLA<select><option>Same business day</option><option>Within 24 hours</option></select></label><label class="field-label">Default return window<select><option>30 days</option><option>14 days</option></select></label><label class="field-label">Return destination<select><option>ATI returns hub</option><option>Brand warehouse</option></select></label></div></section>
    <section class="form-section"><h3>Shipping readiness</h3><div class="file-row"><span>Use ATI-branded packing slip and label</span><span>✓ Confirmed</span></div><div class="file-row"><span>Accept ATI-designated last-mile carrier</span><span>✓ Confirmed</span></div><div class="file-row"><span>Complete test order before activation</span><span>Required</span></div></section>${stepButtons()}</div>`,
  () => `<div class="form-page"><div class="step-kicker">STEP 5 · REVIEW</div><h1>Ready for ATI review</h1><p class="intro">Please confirm the information below. ATI will validate your profile, catalogue and operating readiness before approving activation.</p>
    <div class="review-card"><div><b>Brand and business profile</b><p>Maison Élan · Maison Elan Trading LLC · Women's fashion · UAE</p></div><button data-jump="0">Edit</button></div>
    <div class="review-card"><div><b>Documents and compliance</b><p>3 documents uploaded · UAE TRN verified · AED settlement</p></div><button data-jump="1">Edit</button></div>
    <div class="review-card"><div><b>Catalogue and inventory</b><p>24 products · Spreadsheet upload · Near real-time inventory API</p></div><button data-jump="2">Edit</button></div>
    <div class="review-card"><div><b>Fulfilment and returns</b><p>Brand fulfilled · Same-day dispatch · ATI returns hub</p></div><button data-jump="3">Edit</button></div>
    <label style="display:flex;gap:10px;align-items:flex-start;margin-top:24px;font-size:11px;line-height:1.5"><input type="checkbox" checked style="width:auto;margin-top:2px">I confirm that the information provided is accurate and I am authorised to submit this application on behalf of the brand.</label>${stepButtons(true,"Submit application")}</div>`,
];

function renderApplication() {
  $("#application-progress").textContent = applicationSubmitted ? "Submitted" : `${(currentStep + 1) * 20}% complete`;
  $("#application-steps").innerHTML = appSteps.map((step, index) => `<button class="application-step ${index === currentStep ? "active" : ""} ${index < currentStep || applicationSubmitted ? "complete" : ""}" data-app-step="${index}"><span class="step-number">${index < currentStep || applicationSubmitted ? "✓" : index + 1}</span><span><b>${step.title}</b><small>${step.note}</small></span></button>`).join("");
  if (applicationSubmitted) {
    $("#application-content").innerHTML = `<div class="submission-success"><div class="success-mark">✓</div><div class="step-kicker">APPLICATION RECEIVED</div><h1>Thank you, Maison Élan</h1><p>Your application is now with the ATI concession team. You can continue preparing catalogue content while the team completes its review.</p><div class="reference-box"><span>APPLICATION REFERENCE<br><b>ECP-UAE-2027-0048</b></span><span>EXPECTED REVIEW<br><b>3–5 business days</b></span></div><div class="success-actions"><button class="secondary-action" data-reset>Return to introduction</button><button class="primary-action" data-open-ops style="margin:0">View ATI review console <span>→</span></button></div></div>`;
  } else {
    $("#application-content").innerHTML = applicationPages[currentStep]();
  }
  wireApplicationActions();
}

function wireApplicationActions() {
  $$('[data-app-step]').forEach((button) => button.onclick = () => { currentStep = Number(button.dataset.appStep); applicationSubmitted = false; renderApplication(); });
  const next = $('[data-next]');
  if (next) next.onclick = () => { if (currentStep === 4) { applicationSubmitted = true; showToast("Application submitted to ATI review"); } else currentStep += 1; renderApplication(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const prev = $('[data-prev]');
  if (prev) prev.onclick = () => { currentStep = Math.max(0, currentStep - 1); renderApplication(); };
  $$('[data-jump]').forEach((button) => button.onclick = () => { currentStep = Number(button.dataset.jump); renderApplication(); });
  $$('[data-upload]').forEach((button) => button.onclick = () => showToast("Demo upload complete · document added"));
  $$('.choice-card').forEach((card) => card.onclick = () => { card.parentElement.querySelectorAll('.choice-card').forEach((item) => item.classList.remove('selected')); card.classList.add('selected'); });
  $$('[data-open-ops]').forEach((button) => button.onclick = () => setMode("ops"));
  $$('[data-reset]').forEach((button) => button.onclick = resetPartner);
}

function pageHead(title, description, actions = "") { return `<div class="page-head"><div><h1>${title}</h1><p>${description}</p></div><div class="page-actions">${actions}</div></div>`; }
function status(text, color = "green") { return `<span class="status-pill ${color}">${text}</span>`; }

const opsContent = {
  Overview: () => `${pageHead("Good afternoon, Aline", "Here’s what needs attention across external concessions today.", '<button class="btn">Export report</button><button class="btn primary" data-nav="Vendors">Review applications</button>')}
    <div class="kpi-grid"><div class="kpi-card"><span class="label">ACTIVE VENDORS</span><strong>12</strong><span class="trend">↑ 3 this month</span></div><div class="kpi-card"><span class="label">GMV · THIS MONTH</span><strong>AED 4.8M</strong><span class="trend">↑ 12.4% vs last month</span></div><div class="kpi-card"><span class="label">CATALOGUE READY</span><strong>94.2%</strong><span class="trend">↑ 1.8 pts</span></div><div class="kpi-card"><span class="label">ORDERS AT SLA RISK</span><strong>3</strong><span class="trend neutral">Across 2 vendors</span></div></div>
    <div class="dashboard-grid"><div class="panel"><div class="panel-head"><h2>Recent activity</h2><button>View audit log</button></div><div class="activity-list">
      <div class="activity-item"><span class="activity-icon">✓</span><span><b>Maison Élan submitted an application</b><small>24 products · UAE · Brand fulfilled</small></span><time>2 min ago</time></div>
      <div class="activity-item"><span class="activity-icon">⇄</span><span><b>Inventory reconciliation completed</b><small>18,420 SKU-location records · 6 exceptions</small></span><time>18 min ago</time></div>
      <div class="activity-item"><span class="activity-icon">▣</span><span><b>Order ECP-785204 split across two sources</b><small>Maison Élan + ATI Dubai warehouse</small></span><time>31 min ago</time></div>
      <div class="activity-item"><span class="activity-icon">↩</span><span><b>Return QC completed</b><small>Refund signal sent to Salesforce Commerce Cloud</small></span><time>1 hr ago</time></div>
    </div></div><div class="panel"><div class="panel-head"><h2>Needs attention</h2><button>View all</button></div><div class="attention-list"><div class="attention-card"><b>4 applications awaiting review</b><p>Oldest application has been pending for 2 business days.</p></div><div class="attention-card"><b>3 orders approaching dispatch SLA</b><p>Maison Élan and Atelier Noura require follow-up.</p></div><div class="attention-card"><b>6 catalogue validation errors</b><p>Missing Arabic descriptions and image ratios.</p></div></div></div></div>`,
  Vendors: () => `${pageHead("Vendors", "Onboard, approve and manage external concession partners.", '<button class="btn">Configure onboarding</button><button class="btn primary" data-toast="Vendor invitation created">Invite vendor</button>')}
    <div class="data-card"><div class="filter-bar"><input placeholder="Search vendors or brands"><select><option>All statuses</option><option>Pending review</option><option>Active</option></select><select><option>All markets</option><option>UAE</option><option>KSA</option><option>Kuwait</option></select></div><table class="data-table"><thead><tr><th>VENDOR</th><th>MARKET</th><th>CATALOGUE</th><th>ORDERS</th><th>STATUS</th><th></th></tr></thead><tbody>
      <tr><td><span class="entity-cell"><i class="entity-logo">M</i><span><b>Maison Élan</b><small>Women's fashion · Applied today</small></span></span></td><td>UAE</td><td>24 SKUs</td><td>—</td><td>${status("PENDING REVIEW","amber")}</td><td><button class="link-button" data-review>Review →</button></td></tr>
      <tr><td><span class="entity-cell"><i class="entity-logo">A</i><span><b>Atelier Noura</b><small>Accessories · Brand fulfilled</small></span></span></td><td>UAE</td><td>1,284 SKUs</td><td>642</td><td>${status("ACTIVE")}</td><td><button class="link-button">Open →</button></td></tr>
      <tr><td><span class="entity-cell"><i class="entity-logo">L</i><span><b>Lumière Maison</b><small>Home · ATI warehouse</small></span></span></td><td>UAE / KSA</td><td>386 SKUs</td><td>214</td><td>${status("ACTIVE")}</td><td><button class="link-button">Open →</button></td></tr>
      <tr><td><span class="entity-cell"><i class="entity-logo">O</i><span><b>Oud Alchemy</b><small>Beauty · Hybrid fulfilment</small></span></span></td><td>UAE</td><td>94 SKUs</td><td>173</td><td>${status("ON HOLD","red")}</td><td><button class="link-button">Open →</button></td></tr>
    </tbody></table></div>`,
  Catalogue: () => `${pageHead("Catalogue moderation", "Review AI PIM validation, content quality and publication readiness.", '<button class="btn">Download template</button><button class="btn primary" data-toast="Bulk catalogue upload started">Upload catalogue</button>')}
    <div class="kpi-grid"><div class="kpi-card"><span class="label">TOTAL PRODUCTS</span><strong>18,420</strong><span class="trend">Across 12 vendors</span></div><div class="kpi-card"><span class="label">AWAITING REVIEW</span><strong>38</strong><span class="trend neutral">12 new today</span></div><div class="kpi-card"><span class="label">READY TO PUBLISH</span><strong>126</strong><span class="trend">All validations passed</span></div><div class="kpi-card"><span class="label">CONTENT HEALTH</span><strong>94.2%</strong><span class="trend">AI PIM score</span></div></div>
    <div class="catalog-grid"><div class="product-card"><div class="product-visual">M</div><h3>Sculpted Crepe Dress</h3><p>Maison Élan · ME-DR-104 · AED 1,850</p><div class="product-meta">${status("READY")}<button class="link-button">Review</button></div></div><div class="product-card"><div class="product-visual v2">M</div><h3>Draped Silk Blouse</h3><p>Maison Élan · ME-BL-208 · AED 980</p><div class="product-meta">${status("2 ISSUES","amber")}<button class="link-button">Resolve</button></div></div><div class="product-card"><div class="product-visual v3">A</div><h3>Mini Crescent Bag</h3><p>Atelier Noura · AN-BG-442 · AED 2,250</p><div class="product-meta">${status("APPROVED")}<button class="link-button">Open</button></div></div></div>`,
  Inventory: () => `${pageHead("Inventory", "Monitor SKU-location availability, buffers and reconciliation health.", '<button class="btn">Run reconciliation</button><button class="btn primary" data-toast="Inventory rules saved">Configure buffers</button>')}
    <div class="kpi-grid"><div class="kpi-card"><span class="label">SELLABLE UNITS</span><strong>42,680</strong><span class="trend">Across 19 locations</span></div><div class="kpi-card"><span class="label">IN SYNC</span><strong>99.8%</strong><span class="trend">Last sync 42 sec ago</span></div><div class="kpi-card"><span class="label">LOW STOCK SKUS</span><strong>64</strong><span class="trend neutral">Below buffer</span></div><div class="kpi-card"><span class="label">EXCEPTIONS</span><strong>6</strong><span class="trend neutral">Require mapping</span></div></div>
    <div class="data-card"><table class="data-table"><thead><tr><th>PRODUCT</th><th>VENDOR</th><th>LOCATION</th><th>AVAILABLE</th><th>BUFFER</th><th>SYNC HEALTH</th></tr></thead><tbody><tr><td><b>ME-DR-104</b><br><small>Sculpted Crepe Dress</small></td><td>Maison Élan</td><td>Dubai Design District</td><td>18</td><td>2</td><td>${status("IN SYNC")}</td></tr><tr><td><b>AN-BG-442</b><br><small>Mini Crescent Bag</small></td><td>Atelier Noura</td><td>ATI Dubai WH</td><td>7</td><td>2</td><td>${status("LOW STOCK","amber")}</td></tr><tr><td><b>LM-HM-090</b><br><small>Marble Side Table</small></td><td>Lumière Maison</td><td>Jebel Ali WH</td><td>22</td><td>5</td><td>${status("IN SYNC")}</td></tr></tbody></table></div>`,
  Orders: () => `${pageHead("Orders", "Orchestrate concession orders, fulfilment legs and SLA exceptions.", '<button class="btn">Export orders</button><button class="btn primary" data-toast="Order created for demo">Create manual order</button>')}
    <div class="data-card"><div class="filter-bar"><input placeholder="Search order or customer reference"><select><option>All statuses</option><option>At SLA risk</option><option>Dispatched</option></select></div><table class="data-table"><thead><tr><th>ORDER</th><th>CREATED</th><th>VENDOR / SOURCE</th><th>VALUE</th><th>SLA</th><th>STATUS</th></tr></thead><tbody><tr><td><b>ECP-785204</b><br><small>2 fulfilment legs</small></td><td>Today, 10:42</td><td>Maison Élan + ATI WH</td><td>AED 2,830</td><td>48 min</td><td>${status("PARTIALLY PACKED","blue")}</td></tr><tr><td><b>ECP-785198</b><br><small>1 fulfilment leg</small></td><td>Today, 10:18</td><td>Atelier Noura</td><td>AED 2,250</td><td>12 min</td><td>${status("AT RISK","amber")}</td></tr><tr><td><b>ECP-785176</b><br><small>1 fulfilment leg</small></td><td>Today, 09:54</td><td>Lumière Maison</td><td>AED 1,460</td><td>Met</td><td>${status("DISPATCHED")}</td></tr></tbody></table></div>`,
  Returns: () => `${pageHead("Returns", "Track eligibility, reverse logistics, QC, refunds and restock decisions.", '<button class="btn">Return policies</button><button class="btn primary" data-toast="Return case opened">Create return</button>')}
    <div class="order-detail"><div class="data-card"><div class="panel-head"><h2>Open return cases</h2><button>View all</button></div><table class="data-table"><thead><tr><th>RETURN</th><th>ORDER</th><th>VENDOR</th><th>VALUE</th><th>STATUS</th></tr></thead><tbody><tr><td><b>RTN-10428</b></td><td>ECP-784920</td><td>Maison Élan</td><td>AED 1,850</td><td>${status("QC COMPLETE")}</td></tr><tr><td><b>RTN-10422</b></td><td>ECP-784816</td><td>Atelier Noura</td><td>AED 2,250</td><td>${status("IN TRANSIT","blue")}</td></tr><tr><td><b>RTN-10411</b></td><td>ECP-784654</td><td>Lumière Maison</td><td>AED 1,460</td><td>${status("PICKUP BOOKED","amber")}</td></tr></tbody></table></div><div class="panel"><div class="panel-head"><h2>RTN-10428 timeline</h2></div><div class="timeline"><div class="timeline-row"><i class="timeline-dot"></i><span><b>QC passed · resaleable</b><small>ATI Returns Hub · 14:26</small></span></div><div class="timeline-row"><i class="timeline-dot"></i><span><b>Refund signal sent to SFCC</b><small>Reference RF-88410 · 14:27</small></span></div><div class="timeline-row"><i class="timeline-dot"></i><span><b>Vendor chargeback queued</b><small>Next settlement cycle</small></span></div></div></div></div>`,
  Settlements: () => `${pageHead("Settlements", "Review vendor sales, commissions, returns, adjustments and net payable.", '<button class="btn">Configure terms</button><button class="btn primary" data-toast="Settlement statement generated">Generate statements</button>')}
    <div class="kpi-grid"><div class="kpi-card"><span class="label">GROSS SALES · SEP</span><strong>AED 4.8M</strong><span class="trend">Current period</span></div><div class="kpi-card"><span class="label">COMMISSION</span><strong>AED 1.34M</strong><span class="trend neutral">27.9% blended</span></div><div class="kpi-card"><span class="label">RETURNS & CHARGEBACKS</span><strong>AED 184K</strong><span class="trend neutral">3.8% of gross sales</span></div><div class="kpi-card"><span class="label">NET PAYABLE</span><strong>AED 3.28M</strong><span class="trend">Reconciled 99.96%</span></div></div>
    <div class="data-card"><table class="data-table"><thead><tr><th>VENDOR</th><th>PERIOD</th><th>GROSS SALES</th><th>DEDUCTIONS</th><th>NET PAYABLE</th><th>RECONCILIATION</th><th></th></tr></thead><tbody><tr><td><b>Atelier Noura</b></td><td>01–15 Sep</td><td>AED 742,800</td><td>AED 211,480</td><td>AED 531,320</td><td>${status("MATCHED")}</td><td><button class="link-button">Statement</button></td></tr><tr><td><b>Lumière Maison</b></td><td>01–15 Sep</td><td>AED 506,200</td><td>AED 136,940</td><td>AED 369,260</td><td>${status("2 EXCEPTIONS","amber")}</td><td><button class="link-button">Review</button></td></tr><tr><td><b>Oud Alchemy</b></td><td>01–15 Sep</td><td>AED 384,900</td><td>AED 101,220</td><td>AED 283,680</td><td>${status("MATCHED")}</td><td><button class="link-button">Statement</button></td></tr></tbody></table></div>`,
  Integrations: () => `${pageHead("Integrations", "Monitor data exchange across ATI, Fynd and external partners.", '<button class="btn">Event log</button><button class="btn primary" data-toast="Connector setup opened">Add connection</button>')}
    <div class="integration-grid"><div class="integration-card"><div class="integration-logo">SF</div><h3>Salesforce Commerce Cloud</h3><p>Products, PriceBooks, orders, returns and customer-facing status.</p><div class="sync-row"><span>● Connected</span><span>36 sec ago</span></div></div><div class="integration-card"><div class="integration-logo">ERP</div><h3>ATI ERP & vendor master</h3><p>Vendor identity, product publication, purchase orders and finance events.</p><div class="sync-row"><span>● Connected</span><span>4 min ago</span></div></div><div class="integration-card"><div class="integration-logo">PIM</div><h3>Fynd AI PIM</h3><p>Catalogue mapping, enrichment, Arabic content, moderation and publishing.</p><div class="sync-row"><span>● Healthy</span><span>Live</span></div></div><div class="integration-card"><div class="integration-logo">OMS</div><h3>Fynd OMS</h3><p>Order ingestion, routing, split fulfilment, SLA and returns orchestration.</p><div class="sync-row"><span>● Healthy</span><span>Live</span></div></div><div class="integration-card"><div class="integration-logo">WMS</div><h3>ATI Warehouse Management</h3><p>Warehouse fulfilment, appointments, receipts, QC and stock updates.</p><div class="sync-row"><span>● Connected</span><span>2 min ago</span></div></div><div class="integration-card"><div class="integration-logo">3PL</div><h3>Last-mile & reverse logistics</h3><p>Labels, tracking, pickup scheduling and reverse-logistics events.</p><div class="sync-row"><span style="color:#a76708">● 1 warning</span><span>Check log</span></div></div></div>`,
};

function renderOps() {
  $("#rail-nav").innerHTML = railItems.map(([icon, label], index) => `<button class="rail-button ${index === 1 ? "active" : ""}"><span>${icon}</span>${label}</button>`).join("");
  $("#section-nav").innerHTML = opsPages.map((page) => `<button class="section-button ${page === activeOpsPage ? "active" : ""}" data-nav="${page}">${page}</button>`).join("");
  $("#ops-content").innerHTML = opsContent[activeOpsPage]();
  $$('[data-nav]').forEach((button) => button.onclick = () => { activeOpsPage = button.dataset.nav; renderOps(); });
  $$('[data-toast]').forEach((button) => button.onclick = () => showToast(button.dataset.toast));
  const review = $('[data-review]');
  if (review) review.onclick = () => {
    showToast("Maison Élan approved · activation checklist opened");
    review.closest('tr').querySelector('.status-pill').outerHTML = status("APPROVED");
    review.textContent = "Open →";
  };
}

$$('.demo-switch button').forEach((button) => button.onclick = () => setMode(button.dataset.mode));
$('#start-application').onclick = startApplication;
$$('[data-open-ops]').forEach((button) => button.onclick = () => setMode('ops'));
$$('[data-reset]').forEach((button) => button.onclick = resetPartner);
renderOps();
