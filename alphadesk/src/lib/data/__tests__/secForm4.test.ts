import { describe, expect, it } from 'vitest';
import { parseForm4 } from '../secForm4';

const xml = `<ownershipDocument>
<reportingOwner><reportingOwnerId><rptOwnerName>HUANG JEN HSUN</rptOwnerName></reportingOwnerId>
<reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>1</isOfficer><officerTitle>President and CEO</officerTitle></reportingOwnerRelationship></reportingOwner>
<nonDerivativeTable>
<nonDerivativeTransaction><transactionDate><value>2026-11-04</value></transactionDate><transactionCoding><transactionCode>S</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>150.5</value></transactionPricePerShare></transactionAmounts>
<postTransactionAmounts><sharesOwnedFollowingTransaction><value>9000</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction>
<nonDerivativeTransaction><transactionDate><value>2026-11-04</value></transactionDate><transactionCoding><transactionCode>F</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>50</value></transactionShares></transactionAmounts></nonDerivativeTransaction>
</nonDerivativeTable></ownershipDocument>`;

describe('parseForm4', () => {
  it('keeps open-market trades, skips tax withholding, formats names', () => {
    const r = parseForm4(xml, 'NVDA', 'https://sec.gov/x', '0001-26-1');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ insider: 'Jen Hsun Huang', title: 'President and CEO', type: 'Sell', shares: 1000, price: 150.5, value: 150500, sharesOwnedAfter: 9000, date: '2026-11-04' });
  });
  it('labels directors without an officer title', () => {
    const r = parseForm4(xml.replace('<officerTitle>President and CEO</officerTitle>', ''), 'NVDA', 'u', 'a');
    expect(r[0].title).toBe('Director');
  });
});
