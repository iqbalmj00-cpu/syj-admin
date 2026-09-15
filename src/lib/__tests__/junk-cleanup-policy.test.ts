import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyStoredDumpsterOnlyCleanup as classify} from '../junk-cleanup-policy.ts';
const dumpsters={name:'Example Dumpsters',categories:['Dumpster rental service'],serviceTypes:['dumpster_rental']};
test('stored dumpster-only labels propose policy exclusion without claiming verified absence',()=>{
 const decision=classify(dumpsters);assert.equal(decision.action,'propose_archive');assert.equal(decision.basis,'stored_data_policy');assert.ok(decision.evidence.length);
 assert.equal(classify({...dumpsters,categories:['Dumpster rental service','Service establishment']}).action,'propose_archive');
});
test('all additional services protect current leads, including non-junk services',()=>{
 for(const extra of ['Junk removal service','Waste management service','Trash pickup','Freight hauling','Towing service','Moving company','Roofing contractor','Portable toilet rental','Other','Equipment rental agency']) assert.equal(classify({...dumpsters,categories:[...dumpsters.categories,extra]}).action,'keep',extra);
 for(const extra of ['junk_removal','moving','waste_management','junk_cars','unknown']) assert.equal(classify({...dumpsters,serviceTypes:['dumpster_rental',extra]}).action,'keep',extra);
});
test('every non-dumpster and unclear current lead stays kept',()=>{
 for(const name of ['Generic Hauling','Cash for Junk Cars','Routine Trash Pickup','Freight Hauling','Example','Dumpster Rental']) assert.equal(classify({name}).action,'keep',name);
 assert.equal(classify({name:'Example',companyType:'dumpster_rental',offersDumpsterRental:true,offersJunkRemoval:false}).action,'keep');
});
test('structured additional or uncertain service and description evidence protects',()=>{
 for(const offered of [{state:'confirmed',value:true},{state:'unknown',value:false},{}]) assert.equal(classify({...dumpsters,enrichmentRecords:[{serviceScope:'junk_removal',data:{facts:{'service.offered':offered}}}]}).action,'keep');
 for(const text of ['We also offer junk removal.','We provide towing and freight services.','We do not offer junk removal.','Dumpsters for your DIY junk removal.']) assert.equal(classify({...dumpsters,businessDescription:text}).action,'keep');
});
test('archive and clients remain protected',()=>{
 assert.equal(classify({...dumpsters,archivedAt:new Date()}).reason,'already_archived');assert.equal(classify({...dumpsters,isExistingClient:true}).reason,'existing_client_preserved');
});

test('ambiguous removal, hauling and additional rental names protect current leads',()=>{
 for(const name of ['North Texas Waste Removal','Big A Garbage Removal Inc','Dump Daddy Trailer Rentals','AAA Trash Be Gone','Example Hauling','Example Transport','Example Carting','Junk Rats Dumpsters','BHJUNK','Junker Picker Upper','JunkGone','Junk Off','Hughes Haulage','Trust Recycle & Waste',"Stan’s Cans dumpsters & demo",'Titan Dumpster and Equipment Rentals LLC','Top Tier Roll-Offs and Outdoor Services LLC','J-Pro Rentals Dumpsters and More LLC','Southern Heritage Home Services','Gulf Coast Dumpster Rentals & Property Solutions','Marki Roll-Off Container Inc / Coslar Sanitation LLC','Top Tier Trailers',"Jose’s dump trailer",'B&M dumptrailer services','Southside Transfer Station','Rubbish Busters','Free Of Debris LLC','All Pro Waste Services','Modern Waste Disposal','Commercial Waste Partners','We Talk Trash']) assert.equal(classify({...dumpsters,name}).action,'keep',name);
});
