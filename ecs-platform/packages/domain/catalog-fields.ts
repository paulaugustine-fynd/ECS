export const importFields=['partner_code','brand','vendor_sku','gtin','parent_sku','title_en','title_ar','category','colour','size','list_price','selling_price','currency','image_url','location_code','quantity','material','country_of_origin','skin_type','finish','scent'] as const;
export const requiredHeaders=importFields.slice(0,16);
