/**
 * MathQuest Google Sheets backend
 * 1) Buat/siapkan Google Spreadsheet.
 * 2) Tempel ID spreadsheet ke SPREADSHEET_ID.
 * 3) Deploy > New deployment > Web app; Execute as: Me; Who has access: Anyone.
 * 4) Salin URL /exec ke SHEETS_WEB_APP_URL di script.js.
 * Jangan simpan data sensitif selain identitas dan jawaban yang memang dibutuhkan.
 */
const SPREADSHEET_ID = 'TEMPEL_ID_GOOGLE_SPREADSHEET_DI_SINI';
const SHEET_NAME = 'LKM';
const GURU_PIN = '1234'; // Ganti dengan PIN khusus guru yang kuat.
const HEADERS = ['absen', 'nama', 'status', 'waktu', 'waktuLokal', 'jawabanJson'];

function getSheet_() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID.indexOf('TEMPEL_') === 0) throw new Error('SPREADSHEET_ID belum diatur.');
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  return sheet;
}

function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function jsonp_(obj, callback) {
  const cb = String(callback || '');
  if (!/^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(cb)) return json_({ok:false,error:'Callback tidak valid.'});
  return ContentService.createTextOutput(cb + '(' + JSON.stringify(obj) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}
function norm_(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
function readRows_() {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  return values.slice(1).filter(r => r[0] !== '' && r[1] !== '').map(r => ({
    absen: String(r[0]), nama: String(r[1]), status: String(r[2] || 'Dikumpulkan'),
    waktu: r[3] instanceof Date ? r[3].toISOString() : String(r[3] || ''),
    waktuLokal: String(r[4] || ''), jawaban: safeParse_(r[5])
  }));
}
function safeParse_(s) { try { return JSON.parse(String(s || '[]')); } catch (e) { return []; } }

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const action = String(p.action || '');
    let result;
    if (action === 'checkPin') {
      result = { ok: true, valid: String(p.pin || '') === GURU_PIN };
    } else if (action === 'listLKM') {
      if (String(p.pin || '') !== GURU_PIN) result = { ok:false, error:'PIN guru salah atau sesi tidak sah.' };
      else result = { ok:true, data:readRows_() };
    } else if (action === 'checkSubmission') {
      const match = readRows_().some(r => String(r.absen) === String(p.absen || '') && norm_(r.nama) === norm_(p.nama));
      result = { ok:true, submitted:match };
    } else {
      result = { ok:false, error:'Action tidak dikenal.' };
    }
    return p.callback ? jsonp_(result, p.callback) : json_(result);
  } catch (err) {
    const p = (e && e.parameter) || {};
    const result = { ok:false, error:String(err.message || err) };
    return p.callback ? jsonp_(result, p.callback) : json_(result);
  }
}

function doPost(e) {
  try {
    const p = (e && e.parameter) || {};
    if (String(p.action || '') !== 'submitLKM') return json_({ok:false,error:'Action tidak dikenal.'});
    const data = JSON.parse(String(p.payload || '{}'));
    if (!String(data.absen || '').trim() || !String(data.nama || '').trim() || !Array.isArray(data.jawaban)) {
      return json_({ok:false,error:'Data LKM tidak lengkap.'});
    }
    const sheet = getSheet_();
    const values = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim() === String(data.absen).trim() && norm_(values[i][1]) === norm_(data.nama)) { rowIndex = i + 1; break; }
    }
    const row = [String(data.absen), String(data.nama).trim(), 'Dikumpulkan', new Date(), String(data.waktuLokal || ''), JSON.stringify(data.jawaban)];
    if (rowIndex > 0) sheet.getRange(rowIndex, 1, 1, HEADERS.length).setValues([row]);
    else sheet.appendRow(row);
    return json_({ok:true,message:'LKM tersimpan.'});
  } catch (err) {
    return json_({ok:false,error:String(err.message || err)});
  }
}
