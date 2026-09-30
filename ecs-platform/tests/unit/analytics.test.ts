import {describe,it,expect} from 'vitest';
import {analyticsQuery,csvCell} from '../../packages/domain/analytics';
describe('analytics input and safe CSV',()=>{
 it('accepts a bounded UTC date cohort and rejects invalid, reversed, excessive and unknown filters',()=>{
  const q={market:'AE',from:'2026-09-01',to:'2026-10-01'};
  expect(analyticsQuery.parse(q)).toEqual(q);
  for(const patch of [{from:'2026-02-30'},{to:q.from},{to:'2026-08-01'},{to:'2028-01-01'},{market:'US'},{companyId:'other'},{partnerId:''}])expect(analyticsQuery.safeParse({...q,...patch}).success).toBe(false);
 });
 it('quotes delimiters, quotes and line breaks and neutralizes spreadsheet formulas',()=>{
  expect(csvCell('A,"B"')).toBe('"A,""B"""');
  for(const value of ['=SUM(A1)', '+cmd','-123','@SUM(A1)','\tformula','\rrow','\nrow'])expect(csvCell(value)).toBe(`"'${value}"`);
  expect(csvCell(null)).toBe('""');expect(csvCell(12.5)).toBe('"12.5"');
 });
});
