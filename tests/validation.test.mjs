import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlanning,defaultPlanning } from '../validation.js';
test('imports preserve safe calendar UIDs, strip unknown fields and reject invalid dates or HTML times',()=>{
  const data=defaultPlanning();data.owner='other-account';data.entries=[{date:'2026-10-12',type:'work',note:'<script>plain note</script>',segments:[{id:'existing-v006-id',start:'09:00',end:'17:00',breakMinutes:0}]}];
  const clean=validatePlanning(data);assert.equal(clean.owner,undefined);assert.equal(clean.entries[0].segments[0].id,'existing-v006-id');
  assert.equal(validatePlanning(clean).entries[0].segments[0].id,'existing-v006-id');
  data.entries[0].date='2026-02-31';assert.throws(()=>validatePlanning(data));data.entries[0].date='2026-10-12';
  data.entries[0].segments[0].start='" onfocus="bad';assert.throws(()=>validatePlanning(data));
});
