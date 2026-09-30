# Coach UAE — the existing ECS workflow

Coach is a normal partner in the existing application. There is no separate Coach portal, parallel progress tracker or separate order ledger. Its application uses the existing Bloomingdale’s onboarding page; ATI and Coach work in their normal, separate workspaces.

## Open the demo

- ATI: sign in as `admin@ati.demo` / `Demo123!`.
- Coach: `admin@coachuae.demo` / `CoachDemo123!` once the native demonstration account has been provisioned.
- Use two browser profiles/windows if presenting both roles. A single browser session can only be signed in as one person at a time.
- The completed example remains available to inspect. Do not invite the same email or import the same product codes again. New orders use a fresh reference.

All Coach company details, documents, prices, commercial terms and illustrations are fictional demonstration data. These are not verified Coach authorizations. Fynd, storefront, finance and carrier responses remain simulated; no money moves.

## One complete journey

| Step | Person and existing screen | Action and result |
|---|---|---|
| 1 | ATI → Partners & brands | Click **Invite a partner**, then **Use fictional Coach UAE details**. Create the invitation. The partner is saved in the ordinary partner list. |
| 2 | Coach → invitation link | Accept with the invited email, your display name and a password of at least 12 characters. No invitation email is actually sent; use the displayed link. |
| 3 | Coach → Partner application | Sign in with **Partner application** from the home page. On Business details, fill the fictional Coach sample, review it and save. |
| 4 | Coach → Brands & operations | Check brand, fulfilment model and fictional bank details. Save changes. |
| 5 | Coach → Compliance documents | Upload the trade licence, tax certificate and bank letter. The built-in sample-document buttons save fictional files through normal private document storage. Set a future trade-licence expiry. |
| 6 | Coach → Review & submit | Confirm the demonstration declaration, save, then submit for ATI review. |
| 7 | ATI → Partners & brands → Coach UAE → Review | Start application review. To demonstrate corrections, give a reason and choose **Ask partner for corrections**. |
| 8 | Coach → Partner application | Read ATI’s feedback, correct and save the details, then resubmit. The earlier document and decision history remains. |
| 9 | ATI → Coach review | Start review again. Inspect each document, enter a review reason and approve it. Then **Approve partner**. Approval alone does not open sales. |
| 10 | ATI → Coach review | **Register business for finance**. Refresh until the simulated finance identity exists. |
| 11 | ATI → Commercial terms | Select Coach UAE. Create and approve a version: demo commission **0.20 (20%)**, all partner brands, no category overrides, AED, monthly, 30-day returns and AED 20 return handling. Use the displayed demo date as the effective start and a future end. |
| 12 | ATI → Brand rights | Select Coach. Add brand `br_coach`, market AE, category `Women/Handbags/Shoulder Bags`, effective dates and fictional evidence. Save the draft and approve it with a reason. |
| 13 | ATI → Locations | Add **Coach UAE Demo Warehouse**, owned by Coach, type Partner warehouse, serving Dubai and Abu Dhabi, cut-off 23:00 and capacity 500. These are illustrative settings. |
| 14 | ATI → Coach review | Choose **Prepare brand and locations**. Refresh until the current simulated registrations match. |
| 15 | Coach → Catalogue imports | Choose Coach’s location in **Coach UAE sample collection**. This fills the normal CSV form with three handbags and 20 opening units each. Validate, correct any errors, then submit for review. |
| 16 | ATI → My products | Open each Coach product. Approve its image, approve the product and publish it. Wait for the three simulated publishing confirmations. The content is English and Arabic. |
| 17 | ATI → Coach review | **Send latest stock**, then refresh. The stock should match both simulated destinations. It remains unavailable to customers until the partner is active. |
| 18 | ATI → Coach review | All preparation checks must pass. Enter a reason, **Run safe launch check**, then refresh to completion. This separate safety check does not consume real demo stock. Choose **Open for sales**. |
| 19 | ATI → My orders | Under **Sample basket**, choose Coach UAE, keep or enter a fresh order reference and click **Receive sample order**. The normal order system reserves stock and creates Coach’s shipment. |
| 20 | Coach → My orders → shipment | **Accept shipment → Start picking → confirm the picked quantity for every item → Ready for dispatch → Confirm carrier handover**. Enter a fictional tracking reference. Download the packing slip after packing. Wait for each simulated acknowledgement before the next action. |
| 21 | ATI → same shipment | **Confirm demo delivery**. Delivered sales now create ordinary financial records. Receive a sample invoice reference if desired; it is not a legal tax invoice. |
| 22 | Coach → Returns | Request a return for one delivered Tabby bag, quantity 1, with a reason. |
| 23 | ATI → Returns → that return | Approve, book simulated pickup, receive, then record a good-condition inspection. The returned unit goes back into stock and the customer refund is acknowledged by the simulator. |
| 24 | ATI → Finance & settlements | Create a Coach statement covering the displayed demo date. **Calculate → Mark reviewed → Lock → Export to mock Finance → Simulate payout confirmation**. Download the locked statement. |
| 25 | Coach → Finance & settlements | Read the same statement, deductions and simulated paid result. Coach cannot see another partner’s account. |

## Expected example

The normal sample-order selector buys one of each published Coach product:

| Item | Sample price |
|---|---:|
| Tabby shoulder bag, black | AED 2,250 |
| Brooklyn everyday bag, tan | AED 1,750 |
| Swinger mini bag, cream | AED 1,250 |
| Total sale | AED 5,250 |

With the terms above: AED 5,250 sale − AED 1,050 commission − AED 1,800 partner-payable reversal for the returned Tabby − AED 20 return handling = **AED 2,380 partner payment, simulated**.

The customer receives a simulated **AED 2,250 refund**. That is different from the AED 1,800 reversal of the partner’s share. After one sale of each bag and the Tabby return: Tabby stock 20, Brooklyn 19, Swinger 19; reservations zero.

## What the checks mean

- **Documents reviewed:** ATI approved the latest saved, unexpired sample documents. Not real-world legal verification.
- **Business registered:** the finance simulator returned a business identity.
- **Terms agreed:** an approved agreement covers the demo date.
- **Permission to sell:** approved brand, category and territory match the products.
- **Brand and locations registered:** saved settings match acknowledged simulator records.
- **Products published:** current product versions have publishing confirmations.
- **Stock checked:** saved quantities match both simulated destinations.
- **Customer previews checked:** product content can be read back from the storefront simulator.
- **Safe launch order checked:** a virtual test completed against the current setup.

These are calculated checks, not manually ticked boxes. Editing relevant records can make a check need attention again.

## Other modules already in the same application

**Inventory** edits physical stock, safety stock and damaged stock. **Locations** controls ownership and delivery settings. **System updates** shows successful, waiting or failed handoffs and lets ATI retry eligible failures. **Notifications** shows work needing attention. **SLA & exceptions** tracks overdue work. **Exception centre** handles operational issues. **Analytics** reads operational records. **Reconciliation** checks consistency. **Commercial terms** controls commission and return rules; **Brand rights** controls selling permission. **My products** also supports media review, product corrections, pausing sales and storefront previews.

Optional paths such as damaged returns and exchanges remain in their normal screens. This example does not claim to demonstrate every possible branch or all 54 workbook requirements end to end. Simulation Studio remains separate supplementary coverage, not proof that a feature is native.

## Boundaries

- No live Fynd, SFCC, ERP, courier, bank, email or legally valid invoice/signature.
- No automatic reset: audit history, approvals and locked statements remain.
- Repeat an order with a new reference. Reusing the same order reference must not duplicate the sale.
- Previously saved standalone Coach walkthroughs are retained as historical data, but their UI links now lead to the existing application.
