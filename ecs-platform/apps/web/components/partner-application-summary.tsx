'use client';
import {partnerAccess,type Partner} from '../lib/api';
export function PartnerApplicationSummary({partner,ar=false}:{partner:Partner;ar?:boolean}){
 if(partnerAccess(partner)?.application===false)return <p className="review-feedback" role="note">{ar?'بيانات طلب الشراكة وبيانات الاتصال والخدمات المصرفية غير متاحة لدورك.':'Application, contact and banking details are restricted for your role.'}</p>;
 return <><dl className="application-review"><dt>{ar?'التسجيل':'Registration'}</dt><dd>{partner.application?.registrationNumber||(ar?'غير متوفر':'Not provided')}</dd><dt>{ar?'جهة الاتصال':'Contact'}</dt><dd>{partner.application?.contactName} · {partner.application?.contactEmail}</dd><dt>{ar?'العلامات التجارية':'Brands'}</dt><dd>{partner.application?.brands||(ar?'غير متوفر':'Not provided')}</dd><dt>{ar?'التنفيذ':'Fulfilment'}</dt><dd>{partner.application?.fulfilmentModel?.replaceAll('_',' ')||(ar?'غير متوفر':'Not provided')}</dd></dl>{partner.reviewReason&&<div className="review-feedback"><b>{ar?'ملاحظات المراجعة':'Review feedback'}</b><p>{partner.reviewReason}</p></div>}</>;
}
