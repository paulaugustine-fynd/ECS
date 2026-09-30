import {it,expect} from 'vitest';
import {invoiceInput,permitInvoiceRead} from '../../packages/domain/invoices';
it('accepts reference metadata only, not invoice contents or arbitrary URLs',()=>{
 const value={externalOrderId:'ORDER-1',channel:'BLM-AE',invoiceNumber:'INV/2026/001',version:1,status:'ISSUED',url:'https://sfcc.demo.invalid/invoices/001',issuedAt:'2026-09-23T00:00:00Z',shipmentIds:['leg-1']};
 expect(invoiceInput.safeParse(value).success).toBe(true);
 for(const extra of [{taxAmount:100},{customerEmail:'test@example.com'},{pdf:'base64'},{url:'http://sfcc.demo.invalid/invoice'},{url:'not-a-url'},{url:'https://['},{version:0},{shipmentIds:[]},{shipmentIds:['leg-1','leg-1']}])expect(invoiceInput.safeParse({...value,...extra}).success).toBe(false);
});
it('does not give invoice access to vendor admins or generic ATI catalogue roles',()=>{
 const actor={id:'test',companyId:'ATI',markets:['AE'],partnerId:null,role:'VENDOR_ADMIN'};
 expect(()=>permitInvoiceRead(actor)).toThrow();expect(()=>permitInvoiceRead({...actor,role:'ATI_CATALOG_MODERATOR'})).toThrow();
 expect(()=>permitInvoiceRead({...actor,role:'ATI_FINANCE_ANALYST'})).not.toThrow();
});
