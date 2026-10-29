/* ==========================================================================
   LOGIKA APLIKASI MATHQUEST SMP (TERINTEGRASI FULL & MANDIRI)
   ========================================================================== */
const SHEETS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbweaGpzn5kysVzmOPZaEEv7-Q0GEc9vEX6NF4-WASy6f-KBNAzDvQZgF_Yru1FvUev-/exec";

function sheetsConfigured() {
    return SHEETS_WEB_APP_URL.startsWith("https://script.google.com/macros/s/") && SHEETS_WEB_APP_URL.endsWith("/exec");
}

function sheetsJsonp(params, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        if (!sheetsConfigured()) {
            reject(new Error("URL Google Apps Script belum dikonfigurasi di script.js."));
            return;
        }
        const callbackName = "mqCallback_" + Date.now() + "_" + Math.random().toString(36).slice(2);
        const script = document.createElement("script");
        const query = new URLSearchParams({ ...params, callback: callbackName, _: String(Date.now()) });
        let settled = false;
        const cleanup = () => {
            try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
            script.remove();
            clearTimeout(timer);
        };
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true; cleanup(); reject(new Error("Google Sheets tidak merespons."));
        }, timeoutMs);
        window[callbackName] = result => {
            if (settled) return;
            settled = true; cleanup();
            if (!result || result.ok === false) reject(new Error(result?.error || "Permintaan ke Google Sheets gagal."));
            else resolve(result);
        };
        script.onerror = () => {
            if (settled) return;
            settled = true; cleanup(); reject(new Error("Gagal menghubungi Google Apps Script."));
        };
        script.src = SHEETS_WEB_APP_URL + "?" + query.toString();
        document.head.appendChild(script);
    });
}

async function kirimLKMKeGoogleSheets(dataLKM) {
    if (!sheetsConfigured()) throw new Error("URL Google Apps Script belum dikonfigurasi.");
    await fetch(SHEETS_WEB_APP_URL, {
        method: "POST",
        mode: "no-cors",
        body: new URLSearchParams({ action: "submitLKM", payload: JSON.stringify(dataLKM) })
    });
    for (let i = 0; i < 6; i++) {
        await new Promise(resolve => setTimeout(resolve, 900));
        const cek = await sheetsJsonp({ action: "checkSubmission", absen: dataLKM.absen, nama: dataLKM.nama });
        if (cek.submitted) return true;
    }
    throw new Error("Pengiriman belum terverifikasi, namun data tersimpan di browser.");
}

const TOTAL_SOAL = 10;

let namaSiswa = "";
let nomorAbsen = "";
let teacherPinSession = "";

let stMateri = false;
let stLKM = false;
let stLatihan = false;

let modeAktif = 'langsung';
let skor = 0;
let indeksSoal = 0;
let daftarSoalSesi = [];
let soalAktif = null;

let skorKuisLangsung = null;
let skorKuisKontekstual = null;
let sedangMengerjakanKuis = false;
let intervalTimerKuis = null;
let sisaDetikKuis = 3600;

// Element Canvas
const canvasMateri = document.getElementById('canvasMateri');
const ctxMateri = canvasMateri ? canvasMateri.getContext('2d') : null;

let soalLatihanAktif = null;
const canvasLatihan = document.getElementById('canvasLatihan');
const ctxLatihan = canvasLatihan ? canvasLatihan.getContext('2d') : null;

const canvas = document.getElementById('canvasGaris');
const ctx = canvas ? canvas.getContext('2d') : null;

// State Materi Interaktif Mandiri
let materiDataSimulasi = {
    start: 0,
    steps: [],
    rawOps: [], // Menyimpan informasi apakah operasi berupa pengurangan negatif
    numbers: [],
    currentIndex: 0,
    posAktif: 0,
    arahHadap: 1,
    minV: -10,
    maxV: 10
};

const templatesSoalHots = [
    {
        gen: () => {
            let a = Math.floor(Math.random() * 8) - 4;
            let b = Math.floor(Math.random() * 6) + 2;
            let c = Math.floor(Math.random() * 6) + 2;
            let target = a + b - c;
            return {
                teks: `🔥 (HOTS) Suhu awal daging adalah ${a}°C. Dikeluarkan dari oven sehingga suhunya naik ${b}°C, lalu dimasukkan ke pendingin sehingga turun ${c}°C. Berapakah suhu akhir daging tersebut?`,
                awal: a,
                ops: [b, -c],
                target: target,
                penjelasan: `1. Suhu awal = ${a}°C.<br>2. Naik (+${b}) = ${a+b}°C.<br>3. Turun (-${c}) = ${target}°C.`
            };
        }
    }
];

const bankSoalLangsung = [
    { isHots: false, teks: "1. Hasil operasi: 5 - 8 = ...", awal: 5, ops: [-8], target: -3, penjelasan: "Mulai dari 5, melangkah ke kiri 8 langkah." },
    { isHots: false, teks: "2. Hasil operasi: -3 + 7 = ...", awal: -3, ops: [7], target: 4, penjelasan: "Mulai dari -3, melangkah ke kanan 7 langkah." },
    { isHots: false, teks: "3. Hasil operasi: -2 - 5 = ...", awal: -2, ops: [-5], target: -7, penjelasan: "Mulai dari -2, melangkah ke kiri 5 langkah." },
    { isHots: false, teks: "4. Hasil operasi: -6 + 10 = ...", awal: -6, ops: [10], target: 4, penjelasan: "Mulai dari -6, melangkah ke kanan 10 langkah." },
    { isHots: true, teks: "5. (HOTS) Hitung nilai dari: (-2) + 8 - 11 = ...", awal: -2, ops: [8, -11], target: -5, penjelasan: "-2 + 8 = 6; 6 - 11 = -5." },
    { isHots: true, teks: "6. (HOTS) Jika A = -4 dan B = 9, tentukan A + B - 8 = ...", awal: -4, ops: [9, -8], target: -3, penjelasan: "-4 + 9 = 5; 5 - 8 = -3." },
    { isHots: true, teks: "7. (HOTS) Hasil dari: 4 - (-3) - 10 = ...", awal: 4, ops: [3, -10], target: -3, penjelasan: "4 - (-3) = 7; 7 - 10 = -3." },
    { isHots: true, teks: "8. (HOTS) Titik P di -7 bergerak 12 ke kanan, lalu 9 ke kiri:", awal: -7, ops: [12, -9], target: -4, penjelasan: "-7 + 12 = 5; 5 - 9 = -4." },
    { isHots: true, teks: "9. (HOTS) Nilai x yang memenuhi: -5 + x = 3", awal: -5, ops: [8], target: 8, penjelasan: "3 - (-5) = 8." },
    { isHots: true, teks: "10. (HOTS) Hasil: 0 - 6 + 11 - 9 = ...", awal: 0, ops: [-6, 11, -9], target: -4, penjelasan: "0 - 6 = -6; -6 + 11 = 5; 5 - 9 = -4." }
];

const bankSoalKontekstual = [
    { isHots: false, teks: "1. Suhu kamar mula-mula 3°C. AC dinyalakan sehingga suhu turun 7°C. Berapa suhu sekarang?", awal: 3, ops: [-7], target: -4, penjelasan: "3 - 7 = -4°C." },
    { isHots: false, teks: "2. Kapal selam di kedalaman 5m (-5). Naik 3m. Posisinya?", awal: -5, ops: [3], target: -2, penjelasan: "-5 + 3 = -2m." },
    { isHots: false, teks: "3. Dodi di lantai 2. Turun 6 lantai. Di lantai berapa sekarang?", awal: 2, ops: [-6], target: -4, penjelasan: "2 - 6 = -4 (Lantai B4)." },
    { isHots: false, teks: "4. Suhu es batu -3°C. Naik 8°C. Suhu sekarang?", awal: -3, ops: [8], target: 5, penjelasan: "-3 + 8 = 5°C." },
    { isHots: true, teks: "5. (HOTS) Suhu freezer -6°C. Naik 2°C setiap 10 menit. Suhu setelah 30 menit?", awal: -6, ops: [6], target: 0, penjelasan: "30 menit = 3x naik (+6°C). -6 + 6 = 0°C." },
    { isHots: true, teks: "6. (HOTS) Penyelam A di -8m. Penyelam B 3m di atas A. Kedalaman B?", awal: -8, ops: [3], target: -5, penjelasan: "-8 + 3 = -5m." },
    { isHots: true, teks: "7. (HOTS) Skor tim: 0 → +5 → -8 → +6. Skor akhir?", awal: 0, ops: [5, -8, 6], target: 3, penjelasan: "0 + 5 - 8 + 6 = 3." },
    { isHots: true, teks: "8. (HOTS) Suhu gunung: -5°C → naik 12°C → turun 4°C. Suhu akhir?", awal: -5, ops: [12, -4], target: 3, penjelasan: "-5 + 12 - 4 = 3°C." },
    { isHots: true, teks: "9. (HOTS) Lumba-lumba melompat +4m, lalu menyelam 9m ke bawah. Kedalaman?", awal: 4, ops: [-9], target: -5, penjelasan: "4 - 9 = -5m." },
    { isHots: true, teks: "10. (HOTS) Lift di lantai 5 → turun 8 → naik 2. Posisi lift?", awal: 5, ops: [-8, 2], target: -1, penjelasan: "5 - 8 + 2 = -1 (B1)." }
];

async function simpanIdentitas(e) {
    if (e) e.preventDefault();
    namaSiswa = document.getElementById('txt-nama').value.trim();
    nomorAbsen = document.getElementById('txt-absen').value.trim();

    if (namaSiswa && nomorAbsen) {
        document.getElementById('modal-login').style.display = 'none';
        document.getElementById('lbl-identitas-header').innerText = `${namaSiswa} (Absen: ${nomorAbsen})`;
        muatDataProgressSiswa();
        muatStatusLKMOnline();
    }
}

async function muatStatusLKMOnline() {
    try {
        const result = await sheetsJsonp({ action: "checkSubmission", absen: nomorAbsen, nama: namaSiswa });
        if (result.submitted) {
            stLKM = true;
            const statusLKM = document.getElementById('st-lkm');
            const dashLKM = document.getElementById('dash-lkm-status');
            if (statusLKM) { statusLKM.className = "status-badge complete"; statusLKM.innerText = "Selesai ✅"; }
            if (dashLKM) { dashLKM.className = "status-badge complete"; dashLKM.innerText = "Selesai ✅"; }
        }
    } catch (err) {
        console.warn("Status LKM online:", err.message);
    }
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('mobile-open');
}

function switchTab(tabKey, force = false) {
    if (sedangMengerjakanKuis && !force) {
        alert("⚠️ Kamu sedang mengerjakan sesi kuis! Selesaikan terlebih dahulu.");
        return;
    }

    if (tabKey === 'hub-kuis' || tabKey === 'kuis') {
        if (!evaluasiPrasyaratKuis()) {
            alert("🔒 Kuis Masih Terkunci! Pastikan kamu sudah mempelajari Modul Materi dan menjawab minimal 1 Soal Latihan HOTS dengan benar.");
            return;
        }
    }

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');

    const navEl = document.getElementById(`nav-${tabKey}`);
    const viewEl = document.getElementById(`tab-${tabKey}`);

    if (navEl) navEl.classList.add('active');
    if (viewEl) viewEl.style.display = 'block';

    if (window.innerWidth <= 900) {
        document.getElementById('sidebar').classList.remove('mobile-open');
    }

    if (tabKey === 'materi') {
        muatSimulasiManual();
    }
    if (tabKey === 'latihan' && !soalLatihanAktif) generateSoalLatihanBaru();
    if (tabKey === 'rekap') tampilkanTabelRekap();
}

function evaluasiPrasyaratKuis() {
    const siap = stMateri && stLatihan;
    const btnDash = document.getElementById('btn-dash-kuis');
    const dashStatus = document.getElementById('dash-kuis-status');

    if (btnDash) btnDash.disabled = !siap;
    if (dashStatus) {
        dashStatus.className = siap ? "status-badge complete" : "status-badge pending";
        dashStatus.innerText = siap ? "Terbuka ✅" : "Terkunci 🔒";
    }
    return siap;
}

function tandaiMateriSelesai() {
    stMateri = true;
    document.getElementById('st-materi').className = "status-badge complete";
    document.getElementById('st-materi').innerText = "Selesai ✅";
    document.getElementById('dash-materi-status').className = "status-badge complete";
    document.getElementById('dash-materi-status').innerText = "Selesai ✅";
    evaluasiPrasyaratKuis();
    switchTab('lkm');
}

/* ==========================================================================
   INTERAKSI MODUL MATERI MANDIRI (RENTANG DINAMIS & OPERASI NEGATIF)
   ========================================================================== */
function setPresetMateri(expr) {
    document.getElementById('input-materi-ekspresi').value = expr;
    muatSimulasiManual();
}

function parseMathExpressionDetail(str) {
    let clean = str.replace(/\s+/g, '');
    
    // Tangkap pasangan operasi secara eksplisit (termasuk pengurangan negatif)
    let regex = /([+-]?\d+)|(-\(-?\d+\))|(\+-\d+)/g;
    let matches = clean.match(regex);
    if (!matches) return null;

    let parsed = [];
    let rawOps = [];

    matches.forEach((m, idx) => {
        if (m.startsWith('-(') && m.endsWith(')')) {
            let innerNum = parseInt(m.slice(2, -1));
            parsed.push(-innerNum);
            rawOps.push({ isMinusNegative: innerNum < 0, original: m });
        } else {
            let val = parseInt(m.replace(/[\(\)]/g, ''));
            parsed.push(val);
            rawOps.push({ isMinusNegative: false, original: m });
        }
    });

    return { numbers: parsed, rawOps: rawOps };
}

function muatSimulasiManual() {
    const rawInput = document.getElementById('input-materi-ekspresi').value.trim();
    if (!rawInput) return;

    let res = parseMathExpressionDetail(rawInput);
    if (!res || !res.numbers || res.numbers.length === 0) return;

    let numbers = res.numbers;
    let start = numbers[0];
    let steps = [];
    let current = start;
    let allPoints = [0, start];

    for (let i = 1; i < numbers.length; i++) {
        let val = numbers[i];
        let next = current + val;
        steps.push({ 
            dari: current, 
            ke: next, 
            nilai: val,
            isMinusNegative: res.rawOps[i] ? res.rawOps[i].isMinusNegative : false
        });
        current = next;
        allPoints.push(current);
    }

    // HITUNG RENTANG DINAMIS (MIN & MAX) SECARA OTOMATIS
    let minCalc = Math.min(...allPoints);
    let maxCalc = Math.max(...allPoints);
    
    // Tambahkan Padding Batas Aman
    let rangeSpan = Math.max(10, maxCalc - minCalc);
    let padding = Math.max(3, Math.ceil(rangeSpan * 0.15));
    
    let minV = minCalc - padding;
    let maxV = maxCalc + padding;

    // Minimal Rentang Standar -10 s/d 10 jika operasi kecil
    if (minV > -10 && maxV < 10) {
        minV = -10;
        maxV = 10;
    }

    materiDataSimulasi = {
        start: start,
        steps: steps,
        numbers: numbers,
        currentIndex: 0,
        posAktif: 0,
        arahHadap: 1,
        minV: minV,
        maxV: maxV,
        rawInput: rawInput
    };

    gambarSimulasiManual();
}

function resetSimulasiManual() {
    if (!materiDataSimulasi.numbers || materiDataSimulasi.numbers.length === 0) {
        muatSimulasiManual();
        return;
    }
    materiDataSimulasi.currentIndex = 0;
    materiDataSimulasi.posAktif = 0;
    materiDataSimulasi.arahHadap = 1;
    gambarSimulasiManual();
}

function langkahBerikutnyaManual() {
    if (!materiDataSimulasi.numbers || materiDataSimulasi.numbers.length === 0) {
        muatSimulasiManual();
        return;
    }

    // Tahap 0: Dari 0 ke titik Awal (start)
    if (materiDataSimulasi.currentIndex === 0) {
        materiDataSimulasi.posAktif = materiDataSimulasi.start;
        materiDataSimulasi.arahHadap = materiDataSimulasi.start >= 0 ? 1 : -1;
        materiDataSimulasi.currentIndex = 1;
    } 
    // Tahap berikutnya: Melangkah sesuai operasi
    else if (materiDataSimulasi.currentIndex - 1 < materiDataSimulasi.steps.length) {
        let stepIdx = materiDataSimulasi.currentIndex - 1;
        let step = materiDataSimulasi.steps[stepIdx];
        materiDataSimulasi.posAktif = step.ke;

        // KONTROL KHUSUS OPERASI PENGURANGAN NEGATIF: BERBALIK KE KIRI DULU
        if (step.isMinusNegative) {
            materiDataSimulasi.arahHadap = -1; // Berbalik menghadap kiri, berjalan mundur ke kanan
        } else {
            materiDataSimulasi.arahHadap = step.nilai >= 0 ? 1 : -1;
        }

        materiDataSimulasi.currentIndex++;
    } else {
        alert("🎉 Simulasi operasi ini sudah selesai! Klik 'Reset ke 0' jika ingin mengulang.");
    }
    
    gambarSimulasiManual();
}

function gambarSimulasiManual() {
    if (!ctxMateri) return;
    ctxMateri.clearRect(0, 0, canvasMateri.width, canvasMateri.height);
    
    let minV = materiDataSimulasi.minV || -10;
    let maxV = materiDataSimulasi.maxV || 10;
    
    const y = canvasMateri.height / 2 + 25;
    const getX = (val) => 50 + ((val - minV) / (maxV - minV)) * (canvasMateri.width - 100);

    // Garis Utama Bilangan
    ctxMateri.strokeStyle = "#475569"; ctxMateri.lineWidth = 4;
    ctxMateri.beginPath(); ctxMateri.moveTo(30, y); ctxMateri.lineTo(canvasMateri.width - 30, y); ctxMateri.stroke();

    // Hitung Interval Label Angka Adaptif Supaya Tidak Bertumpuk
    let rangeTotal = maxV - minV;
    let stepInterval = 1;
    if (rangeTotal > 60) stepInterval = 10;
    else if (rangeTotal > 30) stepInterval = 5;
    else if (rangeTotal > 20) stepInterval = 2;

    for (let v = Math.ceil(minV); v <= Math.floor(maxV); v++) {
        if (v % stepInterval === 0 || v === 0 || v === materiDataSimulasi.posAktif) {
            const x = getX(v);
            ctxMateri.beginPath(); ctxMateri.moveTo(x, y - 6); ctxMateri.lineTo(x, y + 6); ctxMateri.stroke();
            ctxMateri.fillStyle = (v === 0) ? "#f59e0b" : "#94a3b8";
            ctxMateri.font = (v === 0 || v === materiDataSimulasi.posAktif) ? "bold 12px sans-serif" : "10px sans-serif";
            ctxMateri.textAlign = "center";
            ctxMateri.fillText(v.toString(), x, y + 22);
        }
    }

    // Gambar Garis Panah Langkah Berdasarkan Tahap Aktivasi
    if (materiDataSimulasi.currentIndex >= 1) {
        let start = materiDataSimulasi.start;
        if (start !== 0) {
            drawStraightArrow(ctxMateri, getX(0), getX(start), y - 18, "#3b82f6");
        }
        
        let activeStepsCount = materiDataSimulasi.currentIndex - 1;
        for (let i = 0; i < activeStepsCount && i < materiDataSimulasi.steps.length; i++) {
            let st = materiDataSimulasi.steps[i];
            let color = st.nilai >= 0 ? "#10b981" : "#ef4444";
            drawStraightArrow(ctxMateri, getX(st.dari), getX(st.ke), y - (32 + i * 22), color);
        }
    }

    // Gambar Roket (Berbalik arah ke kiri jika bernilai negatif atau dikurangi bilangan negatif)
    const xMaskot = getX(materiDataSimulasi.posAktif);
    ctxMateri.save();
    ctxMateri.translate(xMaskot, y - 12);
    if (materiDataSimulasi.arahHadap === -1) {
        ctxMateri.scale(-1, 1); // Cermin roket menghadap kiri
    }
    ctxMateri.font = "28px sans-serif";
    ctxMateri.textAlign = "center";
    ctxMateri.fillText("🚀", 0, 0);
    ctxMateri.restore();

    document.getElementById('lbl-materi-pos').innerText = `📍 Posisi Roket Saat Ini: ${materiDataSimulasi.posAktif}`;
    
    let penjelasanTxt = `
        <div style="display: flex; gap: 15px; justify-content: center; margin-bottom: 6px; font-size: 0.82rem; flex-wrap: wrap;">
            <span><strong style="color: #3b82f6;">🟦 Garis Biru:</strong> Posisi Awal</span>
            <span><strong style="color: #10b981;">🟩 Garis Hijau:</strong> Maju (+)</span>
            <span><strong style="color: #ef4444;">🟥 Garis Merah:</strong> Mundur (-)</span>
        </div>
        💡 <em>Garis bilangan beradaptasi otomatis sesuai rentang angka. Klik <strong>"Langkah Operasi Berikutnya"</strong> untuk melihat pergerakan roket!</em>
    `;
    document.getElementById('lbl-materi-penjelasan').innerHTML = penjelasanTxt;
}

function drawStraightArrow(ctxTarget, xFrom, xTo, yOffset, color) {
    if (!ctxTarget) return;
    ctxTarget.strokeStyle = color; ctxTarget.lineWidth = 3;
    ctxTarget.setLineDash([]);
    ctxTarget.beginPath(); ctxTarget.moveTo(xFrom, yOffset); ctxTarget.lineTo(xTo, yOffset); ctxTarget.stroke();

    const headlen = 8;
    const angle = Math.atan2(0, xTo - xFrom);
    ctxTarget.fillStyle = color;
    ctxTarget.beginPath();
    ctxTarget.moveTo(xTo, yOffset);
    ctxTarget.lineTo(xTo - headlen * Math.cos(angle - Math.PI / 6), yOffset - headlen * Math.sin(angle - Math.PI / 6));
    ctxTarget.lineTo(xTo - headlen * Math.cos(angle + Math.PI / 6), yOffset + headlen * Math.sin(angle + Math.PI / 6));
    ctxTarget.fill();
}

/* ==========================================================================
   LKM & LATIHAN HOTS
   ========================================================================== */
function ambilJawabanLKM() {
    const container = document.getElementById('tab-lkm');
    const jawaban = [];
    container.querySelectorAll('input[id^="lkm-"], textarea[id^="lkm-"], select[id^="lkm-"]').forEach(el => {
        const label = container.querySelector(`label[for="${el.id}"]`);
        let pertanyaan = label ? label.innerText.trim() : '';
        if (!pertanyaan) {
            const group = el.closest('.form-group');
            const groupLabel = group ? group.querySelector('label') : null;
            pertanyaan = groupLabel ? groupLabel.innerText.trim() : el.id;
        }
        jawaban.push({ id: el.id, pertanyaan, jawaban: el.value.trim() });
    });
    return jawaban;
}

function simpanDraftLKM() {
    const dataDraft = { absen: nomorAbsen, nama: namaSiswa, jawaban: ambilJawabanLKM(),
        status: 'Draft', waktu: new Date().toLocaleString('id-ID') };
    localStorage.setItem(`lkm_draft_${nomorAbsen}_${namaSiswa.toLowerCase().replace(/\s+/g, '')}`, JSON.stringify(dataDraft));
    alert("💾 Draft seluruh jawaban LKM berhasil disimpan di browser ini.");
}

async function kumpulkanLKM() {
    const jawaban = ambilJawabanLKM();
    if (!namaSiswa || !nomorAbsen) {
        alert("Silakan masuk dengan nama dan nomor absen terlebih dahulu.");
        return;
    }
    const dataLKM = {
        absen: nomorAbsen,
        nama: namaSiswa,
        jawaban,
        status: 'Dikumpulkan',
        waktu: new Date().toISOString(),
        waktuLokal: new Date().toLocaleString('id-ID')
    };
    
    let semua = JSON.parse(localStorage.getItem('lkm_submissions') || '[]');
    const idx = semua.findIndex(item => String(item.absen) === String(nomorAbsen) && String(item.nama).toLowerCase() === namaSiswa.toLowerCase());
    if (idx >= 0) semua[idx] = dataLKM; else semua.push(dataLKM);
    localStorage.setItem('lkm_submissions', JSON.stringify(semua));

    const tombol = document.querySelector('button[onclick="kumpulkanLKM()"]');
    if (tombol) { tombol.disabled = true; tombol.textContent = '⏳ Mengirim LKM...'; }
    try {
        await kirimLKMKeGoogleSheets(dataLKM);
        stLKM = true;
        document.getElementById('st-lkm').className = "status-badge complete";
        document.getElementById('st-lkm').innerText = "Selesai ✅";
        document.getElementById('dash-lkm-status').className = "status-badge complete";
        document.getElementById('dash-lkm-status').innerText = "Selesai ✅";
        alert("🎉 LKM berhasil dikirim ke Google Sheets!");
    } catch (err) {
        alert("⚠️ LKM tersimpan secara lokal. " + err.message);
    } finally {
        if (tombol) { tombol.disabled = false; tombol.textContent = '🎯 Kumpulkan LKM Digital'; }
        switchTab('latihan');
    }
}

function generateSoalLatihanBaru() {
    const idx = Math.floor(Math.random() * templatesSoalHots.length);
    soalLatihanAktif = templatesSoalHots[idx].gen();
    document.getElementById('input-angka-latihan').value = "";
    document.getElementById('lbl-latihan-soal').innerText = soalLatihanAktif.teks;
    document.getElementById('box-pembahasan-latihan').style.display = "none";
    document.getElementById('container-canvas-latihan').style.display = "none";
}

function gambarPembahasanGaris(ctxCanvas, canvasEl, awal, ops, target) {
    if (!ctxCanvas || !canvasEl) return;
    ctxCanvas.clearRect(0, 0, canvasEl.width, canvasEl.height);

    let arrPositions = [0, awal];
    let curr = awal;
    ops.forEach(op => {
        curr += op;
        arrPositions.push(curr);
    });

    let minV = Math.min(...arrPositions) - 2;
    let maxV = Math.max(...arrPositions) + 2;
    if (minV > -8 && maxV < 8) {
        minV = -8;
        maxV = 8;
    }

    const y = canvasEl.height / 2 + 20;
    const getX = (val) => 50 + ((val - minV) / (maxV - minV)) * (canvasEl.width - 100);

    ctxCanvas.strokeStyle = "#475569"; ctxCanvas.lineWidth = 4;
    ctxCanvas.beginPath(); ctxCanvas.moveTo(30, y); ctxCanvas.lineTo(canvasEl.width - 30, y); ctxCanvas.stroke();

    for (let v = Math.ceil(minV); v <= Math.floor(maxV); v++) {
        const x = getX(v);
        ctxCanvas.beginPath(); ctxCanvas.moveTo(x, y - 6); ctxCanvas.lineTo(x, y + 6); ctxCanvas.stroke();
        ctxCanvas.fillStyle = (v === 0) ? "#f59e0b" : "#94a3b8";
        ctxCanvas.font = (v === 0) ? "bold 12px sans-serif" : "10px sans-serif";
        ctxCanvas.textAlign = "center";
        ctxCanvas.fillText(v.toString(), x, y + 22);
    }

    if (awal !== 0) {
        drawStraightArrow(ctxCanvas, getX(0), getX(awal), y - 18, "#3b82f6");
    }

    let currentPos = awal;
    ops.forEach((op, i) => {
        let nextPos = currentPos + op;
        let color = op >= 0 ? "#10b981" : "#ef4444";
        drawStraightArrow(ctxCanvas, getX(currentPos), getX(nextPos), y - (32 + i * 22), color);
        currentPos = nextPos;
    });

    const xMaskot = getX(target);
    ctxCanvas.font = "28px sans-serif"; ctxCanvas.textAlign = "center";
    ctxCanvas.fillText("🚀", xMaskot, y - 12);
}

function cekJawabanLatihan() {
    const inputVal = parseInt(document.getElementById('input-angka-latihan').value);
    if (isNaN(inputVal)) {
        alert("⚠️ Masukkan terlebih dahulu jawaban angka kamu!");
        return;
    }

    document.getElementById('container-canvas-latihan').style.display = "flex";
    gambarPembahasanGaris(ctxLatihan, canvasLatihan, soalLatihanAktif.awal, soalLatihanAktif.ops, soalLatihanAktif.target);

    const box = document.getElementById('box-pembahasan-latihan');
    box.style.display = "block";

    if (inputVal === soalLatihanAktif.target) {
        document.getElementById('lbl-latihan-status-txt').innerText = "🥳 Sempurna! Jawaban Angka Kamu Tepat!";
        document.getElementById('lbl-latihan-status-txt').style.color = "var(--success)";
        
        stLatihan = true;
        document.getElementById('st-latihan').className = "status-badge complete";
        document.getElementById('st-latihan').innerText = "Selesai ✅";
        document.getElementById('dash-latihan-status').className = "status-badge complete";
        document.getElementById('dash-latihan-status').innerText = "Selesai ✅";
        evaluasiPrasyaratKuis();
    } else {
        document.getElementById('lbl-latihan-status-txt').innerText = `🧐 Kurang Tepat. Jawaban Benar adalah ${soalLatihanAktif.target}`;
        document.getElementById('lbl-latihan-status-txt').style.color = "var(--danger)";
    }

    document.getElementById('lbl-latihan-penjelasan').innerHTML = soalLatihanAktif.penjelasan;
}

/* ==========================================================================
   ARENA KUIS EVALUASI
   ========================================================================== */
function mulaiKuisSpesifik(jenis) {
    if (!evaluasiPrasyaratKuis()) return;
    
    modeAktif = jenis;
    skor = 0; 
    indeksSoal = 0;
    sisaDetikKuis = 3600;
    daftarSoalSesi = (modeAktif === 'langsung') ? bankSoalLangsung : bankSoalKontekstual;

    document.getElementById('quiz-body').style.display = 'block';
    document.getElementById('quiz-result').style.display = 'none';
    document.getElementById('lbl-mode').innerText = (modeAktif === 'langsung') ? "⚡ Hitung Biasa" : "🌍 Soal Cerita";
    
    switchTab('kuis', true);
    sedangMengerjakanKuis = true;
    tampilkanSoalKuis();
    mulaiTimerKuis();
}

function mulaiTimerKuis() {
    if (intervalTimerKuis) clearInterval(intervalTimerKuis);
    intervalTimerKuis = setInterval(() => {
        sisaDetikKuis--;
        const m = Math.floor(sisaDetikKuis / 60);
        const s = sisaDetikKuis % 60;
        const timerEl = document.getElementById('lbl-timer');
        if (timerEl) {
            timerEl.innerText = `⏱️ ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        }
        if (sisaDetikKuis <= 0) {
            clearInterval(intervalTimerKuis);
            alert("⏰ Waktu kuis habis!");
            selesaiKuis();
        }
    }, 1000);
}

function tampilkanSoalKuis() {
    soalAktif = daftarSoalSesi[indeksSoal];
    document.getElementById('input-angka-kuis').value = "";
    document.getElementById('lbl-progress').innerText = `Soal: ${indeksSoal + 1} / ${TOTAL_SOAL}`;
    document.getElementById('lbl-soal').innerText = soalAktif.teks;
    document.getElementById('lbl-emoji').innerText = "🙂";
    document.getElementById('lbl-pesan').innerText = "Ketikkan jawaban angka kamu lalu klik Kunci Jawaban!";
    
    document.getElementById('container-canvas-kuis').style.display = "none";

    document.getElementById('panel-kontrol').innerHTML = `
        <button class="btn btn-accent" style="width: 100%;" onclick="kunciJawabanKuis()">🎯 Kunci Jawaban Saya</button>
    `;
}

function kunciJawabanKuis() {
    const inputVal = parseInt(document.getElementById('input-angka-kuis').value);
    if (isNaN(inputVal)) {
        alert("⚠️ Masukkan jawaban angka terlebih dahulu!");
        return;
    }

    document.getElementById('container-canvas-kuis').style.display = "flex";
    gambarPembahasanGaris(ctx, canvas, soalAktif.awal, soalAktif.ops, soalAktif.target);

    if (inputVal === soalAktif.target) {
        skor += 10;
        document.getElementById('lbl-emoji').innerText = "🥳";
        document.getElementById('lbl-pesan').innerText = `Sempurna! Jawaban Tepat. ${soalAktif.penjelasan} (+10 Poin)`;
    } else {
        document.getElementById('lbl-emoji').innerText = "🧐";
        document.getElementById('lbl-pesan').innerText = `Kurang Tepat. Jawaban Benar adalah ${soalAktif.target}. ${soalAktif.penjelasan}`;
    }

    const tombolLanjut = (indeksSoal < TOTAL_SOAL - 1)
        ? `<button class="btn btn-primary" style="width: 100%;" onclick="lanjutKuis()">➡️ Soal Selanjutnya</button>`
        : `<button class="btn btn-accent" style="width: 100%;" onclick="selesaiKuis()">📊 Lihat Hasil Akhir</button>`;

    document.getElementById('panel-kontrol').innerHTML = tombolLanjut;
}

function lanjutKuis() {
    indeksSoal++;
    tampilkanSoalKuis();
}

function selesaiKuis() {
    if (intervalTimerKuis) clearInterval(intervalTimerKuis);
    sedangMengerjakanKuis = false;
    document.getElementById('quiz-body').style.display = 'none';
    document.getElementById('quiz-result').style.display = 'block';
    document.getElementById('final-score').innerText = `${skor} / 100`;

    if (modeAktif === 'langsung') {
        skorKuisLangsung = skor;
        document.getElementById('status-kuis-langsung').innerText = `Selesai ✅ (${skor}/100)`;
    } else {
        skorKuisKontekstual = skor;
        document.getElementById('status-kuis-kontekstual').innerText = `Selesai ✅ (${skor}/100)`;
    }
    simpanNilaiKeStorage();
}

function simpanNilaiKeStorage() {
    let riwayat = JSON.parse(localStorage.getItem('rekap_nilai_smp') || "[]");
    let idx = riwayat.findIndex(r => parseInt(r.absen) === parseInt(nomorAbsen) && r.nama.toLowerCase() === namaSiswa.toLowerCase());

    let data = {
        absen: nomorAbsen,
        nama: namaSiswa,
        langsung: skorKuisLangsung,
        kontekstual: skorKuisKontekstual,
        lkmStatus: stLKM ? "Selesai ✅" : "Belum",
        waktu: new Date().toLocaleString('id-ID')
    };

    if (idx !== -1) riwayat[idx] = data;
    else riwayat.push(data);

    localStorage.setItem('rekap_nilai_smp', JSON.stringify(riwayat));
}

async function aksesRekapGuru() {
    const pin = prompt("🔒 Masukkan PIN Khusus Guru:");
    if (pin === null) return;
    try {
        const result = await sheetsJsonp({ action: "checkPin", pin });
        if (result.valid) {
            teacherPinSession = pin;
            switchTab('rekap');
        } else {
            alert("❌ PIN guru salah. Akses ditolak.");
        }
    } catch (err) {
        alert("Tidak dapat memverifikasi akses guru. " + err.message);
    }
}

async function tampilkanTabelRekap() {
    const tbody = document.getElementById('tabel-rekap-body');
    tbody.innerHTML = '<tr><td colspan="8">⏳ Memuat data nilai dan LKM...</td></tr>';
    let riwayatNilai = JSON.parse(localStorage.getItem('rekap_nilai_smp') || '[]');
    let dataLKMOnline = [];
    try {
        if (!teacherPinSession) throw new Error("Sesi guru berakhir. Buka kembali Rekap Guru dan masukkan PIN.");
        const remote = await sheetsJsonp({ action: "listLKM", pin: teacherPinSession });
        dataLKMOnline = Array.isArray(remote.data) ? remote.data : [];
    } catch (err) {
        dataLKMOnline = JSON.parse(localStorage.getItem('lkm_submissions') || '[]');
    }

    const map = new Map();
    riwayatNilai.forEach(r => map.set(`${String(r.absen).trim()}|${String(r.nama).toLowerCase().trim()}`, { ...r }));
    dataLKMOnline.forEach(l => {
        const key = `${String(l.absen).trim()}|${String(l.nama).toLowerCase().trim()}`;
        const existing = map.get(key) || { absen: l.absen, nama: l.nama, langsung: null, kontekstual: null, lkmStatus: "Belum", waktu: "-" };
        existing.lkmStatus = l.status || "Dikumpulkan";
        existing.lkmWaktu = l.waktuLokal || l.waktu || "-";
        map.set(key, existing);
    });
    const riwayat = Array.from(map.values()).sort((a, b) => Number(a.absen) - Number(b.absen));
    if (!riwayat.length) {
        tbody.innerHTML = '<tr><td colspan="8">Belum ada data nilai atau LKM terkumpul.</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    riwayat.forEach(r => {
        const n1 = r.langsung !== null && r.langsung !== undefined ? r.langsung : "-";
        const n2 = r.kontekstual !== null && r.kontekstual !== undefined ? r.kontekstual : "-";
        const rata = (typeof r.langsung === 'number' && typeof r.kontekstual === 'number') ? Math.round((r.langsung + r.kontekstual) / 2) : "-";
        const hasLKM = dataLKMOnline.some(l => String(l.absen) === String(r.absen) && String(l.nama).toLowerCase() === String(r.nama).toLowerCase());
        const lkmWaktu = r.lkmWaktu || r.waktu || '-';
        tbody.innerHTML += `
            <tr>
                <td>${escapeHTML(r.absen)}</td>
                <td><b>${escapeHTML(r.nama)}</b></td>
                <td><span class="status-badge ${hasLKM ? 'complete' : 'pending'}">${hasLKM ? 'Dikumpulkan ✅' : 'Belum'}</span></td>
                <td>${escapeHTML(n1)}</td><td>${escapeHTML(n2)}</td>
                <td style="color: var(--accent); font-weight:700;">${escapeHTML(rata)}</td>
                <td style="font-size: 0.8rem; color: var(--text-muted);">${escapeHTML(lkmWaktu)}</td>
                <td><button class="btn btn-success" onclick="unduhLKMpdf(${JSON.stringify(String(r.absen))}, ${JSON.stringify(String(r.nama))})">📄 Unduh LKM PDF</button></td>
            </tr>`;
    });
}

function escapeHTML(value) {
    return String(value ?? '-').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function unduhLKMpdf(absen, nama) {
    const lokal = JSON.parse(localStorage.getItem('lkm_submissions') || '[]');
    let data = lokal.find(item => String(item.absen) === String(absen) && String(item.nama).toLowerCase() === String(nama).toLowerCase());

    if (!data) {
        data = {
            absen: absen,
            nama: nama,
            status: 'Belum Mengisi',
            waktuLokal: '-',
            jawaban: [{ pertanyaan: "Informasi", jawaban: "Siswa belum mengirimkan LKM pada perangkat ini." }]
        };
    }

    let printContainer = document.getElementById('print-container-pdf');
    if (printContainer) printContainer.remove();

    printContainer = document.createElement('div');
    printContainer.id = 'print-container-pdf';
    printContainer.style.cssText = 'display:none;';

    const rowsHtml = (data.jawaban || []).map((item, i) => `
        <tr>
            <td style="text-align:center; border:1px solid #cbd5e1; padding:8px;">${i + 1}</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">${escapeHTML(item.pertanyaan || item.id || '-')}</td>
            <td style="border:1px solid #cbd5e1; padding:8px;">${escapeHTML(item.jawaban || '(Belum diisi)')}</td>
        </tr>
    `).join('');

    printContainer.innerHTML = `
        <div style="font-family: Arial, sans-serif; padding: 25px; color: #1e293b; background: #fff;">
            <h2 style="margin-bottom: 2px; font-size: 18px; text-transform: uppercase;">LEMBAR KERJA PESERTA DIDIK (LKM)</h2>
            <p style="color: #64748b; font-size: 12px; margin-top: 0; margin-bottom: 15px;">MathQuest SMP Kelas VII — Modul Bilangan Bulat</p>
            
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin-bottom: 15px; font-size: 13px; line-height: 1.5;">
                <strong>Nama Siswa:</strong> ${escapeHTML(data.nama)}<br>
                <strong>Nomor Absen:</strong> ${escapeHTML(data.absen)}<br>
                <strong>Waktu Pengumpulan:</strong> ${escapeHTML(data.waktuLokal || data.waktu || '-')}<br>
                <strong>Status Pengerjaan:</strong> ${escapeHTML(data.status || 'Dikumpulkan')}
            </div>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <thead>
                    <tr style="background: #6366f1; color: white;">
                        <th style="border: 1px solid #cbd5e1; padding: 8px; width: 8%; text-align: center;">No.</th>
                        <th style="border: 1px solid #cbd5e1; padding: 8px; width: 46%;">Pertanyaan / Bagian LKM</th>
                        <th style="border: 1px solid #cbd5e1; padding: 8px; width: 46%;">Jawaban Siswa</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>

            <div style="font-size: 12px; border-top: 1px dashed #cbd5e1; padding-top: 10px;">
                <strong>Catatan Guru / Penilaian:</strong><br><br>__________________________________________________________________
            </div>
        </div>
    `;

    document.body.appendChild(printContainer);

    let printStyle = document.getElementById('print-style-pdf');
    if (!printStyle) {
        printStyle = document.createElement('style');
        printStyle.id = 'print-style-pdf';
        printStyle.innerHTML = `
            @media print {
                body * { visibility: hidden; }
                #print-container-pdf, #print-container-pdf * { visibility: visible; }
                #print-container-pdf { display: block !important; position: absolute; left: 0; top: 0; width: 100%; }
            }
        `;
        document.head.appendChild(printStyle);
    }

    window.print();
}

function unduhRekapCSV() {
    let riwayat = JSON.parse(localStorage.getItem('rekap_nilai_smp') || "[]");
    if (riwayat.length === 0) return alert("⚠️ Data rekap kosong.");

    let csv = "\uFEFFNo Absen,Nama Siswa,Status LKM,Hitung Biasa,Soal Cerita,Nilai Rata-Rata,Waktu Pengerjaan\n";
    riwayat.forEach(r => {
        let n1 = r.langsung !== null && r.langsung !== undefined ? r.langsung : 0;
        let n2 = r.kontekstual !== null && r.kontekstual !== undefined ? r.kontekstual : 0;
        let rata = Math.round((n1 + n2) / 2);
        csv += `"${r.absen}","${r.nama}","${r.lkmStatus || 'Selesai'}",${n1},${n2},${rata},"${r.waktu || '-'}"\n`;
    });

    let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Rekap_Nilai_MathQuest_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
}

function hapusSeluruhRekap() {
    if (confirm("⚠️ Yakin ingin menghapus seluruh rekap nilai dari browser?")) {
        localStorage.removeItem('rekap_nilai_smp');
        tampilkanTabelRekap();
    }
}

function muatDataProgressSiswa() {
    let riwayat = JSON.parse(localStorage.getItem('rekap_nilai_smp') || "[]");
    let item = riwayat.find(r => parseInt(r.absen) === parseInt(nomorAbsen) && r.nama.toLowerCase() === namaSiswa.toLowerCase());
    if (item) {
        skorKuisLangsung = item.langsung;
        skorKuisKontekstual = item.kontekstual;
    }
}

window.onload = () => {
    muatSimulasiManual();
};
