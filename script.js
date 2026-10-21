/* ==========================================================================
       LOGIKA APLIKASI & MANAJEMEN STATE MATHQUEST SMP
       ========================================================================== */
    // GANTI URL DI BAWAH DENGAN URL WEB APP GOOGLE APPS SCRIPT YANG BERAKHIR /exec.
    const SHEETS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbweaGpzn5kysVzmOPZaEEv7-Q0GEc9vEX6NF4-WASy6f-KBNAzDvQZgF_Yru1FvUev-/exec"

    function sheetsConfigured() {
        return SHEETS_WEB_APP_URL.startsWith("https://script.google.com/macros/s/") && SHEETS_WEB_APP_URL.endsWith("/exec");
    }

    // Google Apps Script mengembalikan JSONP untuk pembacaan agar bisa dipanggil dari GitHub Pages.
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
                settled = true; cleanup(); reject(new Error("Google Sheets tidak merespons. Periksa URL deployment dan akses Web App."));
            }, timeoutMs);
            window[callbackName] = result => {
                if (settled) return;
                settled = true; cleanup();
                if (!result || result.ok === false) reject(new Error(result?.error || "Permintaan ke Google Sheets gagal."));
                else resolve(result);
            };
            script.onerror = () => {
                if (settled) return;
                settled = true; cleanup(); reject(new Error("Gagal menghubungi Google Apps Script. Pastikan deployment dapat diakses."));
            };
            script.src = SHEETS_WEB_APP_URL + "?" + query.toString();
            document.head.appendChild(script);
        });
    }

    async function kirimLKMKeGoogleSheets(dataLKM) {
        if (!sheetsConfigured()) throw new Error("URL Google Apps Script belum dikonfigurasi di script.js.");
        // URLSearchParams membuat request sederhana sehingga tidak memerlukan CORS preflight.
        await fetch(SHEETS_WEB_APP_URL, {
            method: "POST",
            mode: "no-cors",
            body: new URLSearchParams({ action: "submitLKM", payload: JSON.stringify(dataLKM) })
        });
        // Karena mode no-cors tidak mengizinkan membaca respons POST, verifikasi lewat endpoint status.
        for (let i = 0; i < 6; i++) {
            await new Promise(resolve => setTimeout(resolve, 900));
            const cek = await sheetsJsonp({ action: "checkSubmission", absen: dataLKM.absen, nama: dataLKM.nama });
            if (cek.submitted) return true;
        }
        throw new Error("Pengiriman belum terverifikasi. Periksa deployment Apps Script dan coba kumpulkan lagi.");
    }
    const MIN_VAL = -15;
    const MAX_VAL = 15;
    const TOTAL_SOAL = 10;

    let namaSiswa = "";
    let nomorAbsen = "";

    // STATUS PRASYARAT
    let stMateri = false;
    let stLKM = false;
    let stLatihan = false;

    let modeAktif = 'langsung';
    let skor = 0;
    let indeksSoal = 0;
    let posisiSekarang = 0;
    let daftarSoalSesi = [];
    let soalAktif = null;

    let skorKuisLangsung = null;
    let skorKuisKontekstual = null;
    let sedangMengerjakanKuis = false;

    // SIMULASI MATERI
    let posMateri = 0;
    const canvasMateri = document.getElementById('canvasMateri');
    const ctxMateri = canvasMateri ? canvasMateri.getContext('2d') : null;

    // SIMULASI LATIHAN
    let posLatihan = 0;
    let soalLatihanAktif = null;
    let stepArrowsLatihan = [];
    const canvasLatihan = document.getElementById('canvasLatihan');
    const ctxLatihan = canvasLatihan ? canvasLatihan.getContext('2d') : null;

    // CANVAS KUIS
    const canvas = document.getElementById('canvasGaris');
    const ctx = canvas ? canvas.getContext('2d') : null;

    // BANK SOAL
    const templatesSoalHots = [
        {
            gen: () => {
                let a = Math.floor(Math.random() * 10) - 5;
                let b = Math.floor(Math.random() * 8) + 2;
                let c = Math.floor(Math.random() * 8) + 2;
                let target = a + b - c;
                return {
                    teks: `🔥 (HOTS) Suhu awal daging adalah ${a}°C. Dikeluarkan dari oven sehingga suhunya naik ${b}°C, lalu dimasukkan ke pendingin sehingga turun ${c}°C. Berapakah suhu akhir daging tersebut?`,
                    awal: a, ops: [[1, b], [-1, c]], target: target,
                    penjelasan: `1. Suhu awal = ${a}°C.<br>2. Naik (+${b}) = ${a+b}°C.<br>3. Turun (-${c}) = ${target}°C.`
                };
            }
        }
    ];

    const bankSoalLangsung = [
        { isHots: false, vertikal: false, teks: "1. Hasil operasi: 5 - 8 = ...", awal: 5, ops: [[-1, 8]], target: -3, penjelasan: "Mulai dari 5, geser ke kiri 8 langkah." },
        { isHots: false, vertikal: false, teks: "2. Hasil operasi: -3 + 7 = ...", awal: -3, ops: [[1, 7]], target: 4, penjelasan: "Mulai dari -3, geser ke kanan 7 langkah." },
        { isHots: false, vertikal: false, teks: "3. Hasil operasi: -2 - 5 = ...", awal: -2, ops: [[-1, 5]], target: -7, penjelasan: "Mulai dari -2, geser ke kiri 5 langkah." },
        { isHots: false, vertikal: false, teks: "4. Hasil operasi: -6 + 10 = ...", awal: -6, ops: [[1, 10]], target: 4, penjelasan: "Mulai dari -6, geser ke kanan 10 langkah." },
        { isHots: true, vertikal: false, teks: "5. (HOTS) Hitung nilai dari: (-2) + 8 - 11 = ...", awal: -2, ops: [[1, 8], [-1, 11]], target: -5, penjelasan: "-2 + 8 = 6; 6 - 11 = -5." },
        { isHots: true, vertikal: false, teks: "6. (HOTS) Jika A = -4 dan B = 9, tentukan A + B - 8 = ...", awal: -4, ops: [[1, 9], [-1, 8]], target: -3, penjelasan: "-4 + 9 = 5; 5 - 8 = -3." },
        { isHots: true, vertikal: false, teks: "7. (HOTS) Hasil dari: 4 - (-3) - 10 = ...", awal: 4, ops: [[1, 3], [-1, 10]], target: -3, penjelasan: "4 + 3 = 7; 7 - 10 = -3." },
        { isHots: true, vertikal: false, teks: "8. (HOTS) Titik P di -7 bergerak 12 ke kanan, lalu 9 ke kiri:", awal: -7, ops: [[1, 12], [-1, 9]], target: -4, penjelasan: "-7 + 12 = 5; 5 - 9 = -4." },
        { isHots: true, vertikal: false, teks: "9. (HOTS) Nilai x yang memenuhi: -5 + x = 3", awal: -5, ops: [[1, 8]], target: 8, penjelasan: "3 - (-5) = 8." },
        { isHots: true, vertikal: false, teks: "10. (HOTS) Hasil: 0 - 6 + 11 - 9 = ...", awal: 0, ops: [[-1, 6], [1, 11], [-1, 9]], target: -4, penjelasan: "0 - 6 = -6; -6 + 11 = 5; 5 - 9 = -4." }
    ];

    const bankSoalKontekstual = [
        { isHots: false, vertikal: true, teks: "1. Suhu kamar mula-mula 3°C. AC dinyalakan sehingga suhu turun 7°C. Berapa suhu sekarang?", awal: 3, ops: [[-1, 7]], target: -4, penjelasan: "3 - 7 = -4°C." },
        { isHots: false, vertikal: true, teks: "2. Kapal selam di kedalaman 5m (-5). Naik 3m. Posisinya?", awal: -5, ops: [[1, 3]], target: -2, penjelasan: "-5 + 3 = -2m." },
        { isHots: false, vertikal: true, teks: "3. Dodi di lantai 2. Turun 6 lantai. Di lantai berapa sekarang?", awal: 2, ops: [[-1, 6]], target: -4, penjelasan: "2 - 6 = -4 (Lantai B4)." },
        { isHots: false, vertikal: true, teks: "4. Suhu es batu -3°C. Naik 8°C. Suhu sekarang?", awal: -3, ops: [[1, 8]], target: 5, penjelasan: "-3 + 8 = 5°C." },
        { isHots: true, vertikal: true, teks: "5. (HOTS) Suhu freezer -6°C. Naik 2°C setiap 10 menit. Suhu setelah 30 menit?", awal: -6, ops: [[1, 6]], target: 0, penjelasan: "30 menit = 3x naik (+6°C). -6 + 6 = 0°C." },
        { isHots: true, vertikal: true, teks: "6. (HOTS) Penyelam A di -8m. Penyelam B 3m di atas A. Kedalaman B?", awal: -8, ops: [[1, 3]], target: -5, penjelasan: "-8 + 3 = -5m." },
        { isHots: true, vertikal: true, teks: "7. (HOTS) Skor tim: 0 → +5 → -8 → +6. Skor akhir?", awal: 0, ops: [[1, 5], [-1, 8], [1, 6]], target: 3, penjelasan: "0 + 5 - 8 + 6 = 3." },
        { isHots: true, vertikal: true, teks: "8. (HOTS) Suhu gunung: -5°C → naik 12°C → turun 4°C. Suhu akhir?", awal: -5, ops: [[1, 12], [-1, 4]], target: 3, penjelasan: "-5 + 12 - 4 = 3°C." },
        { isHots: true, vertikal: true, teks: "9. (HOTS) Lumba-lumba melompat +4m, lalu menyelam 9m ke bawah. Kedalaman?", awal: 4, ops: [[-1, 9]], target: -5, penjelasan: "4 - 9 = -5m." },
        { isHots: true, vertikal: true, teks: "10. (HOTS) Lift di lantai 5 → turun 8 → naik 2. Posisi lift?", awal: 5, ops: [[-1, 8], [1, 2]], target: -1, penjelasan: "5 - 8 + 2 = -1 (B1)." }
    ];

    /* --- INITIALIZATION & NAV --- */
    function simpanIdentitas(e) {
        e.preventDefault();
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
                evaluasiPrasyaratKuis();
            }
        } catch (err) {
            // Jika koneksi tidak tersedia, aplikasi tetap bisa digunakan; status online akan diperiksa saat pengumpulan.
            console.warn("Status LKM online belum dapat dimuat:", err.message);
        }
    }

    function toggleSidebar() {
        document.getElementById('sidebar').classList.toggle('mobile-open');
    }

    function switchTab(tabKey) {
        if (sedangMengerjakanKuis) {
            alert("⚠️ Kamu sedang mengerjakan sesi kuis! Selesaikan terlebih dahulu.");
            return;
        }

        if (tabKey === 'hub-kuis' || tabKey === 'kuis') {
            if (!evaluasiPrasyaratKuis()) {
                alert("🔒 Kuis Masih Terkunci! Pastikan kamu sudah menyelesaikan Modul Materi, mengumpulkan LKM Digital, dan menjawab minimal 1 Soal Latihan HOTS dengan benar.");
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

        if (tabKey === 'materi') gambarMateri();
        if (tabKey === 'latihan' && !soalLatihanAktif) generateSoalLatihanBaru();
        if (tabKey === 'rekap') tampilkanTabelRekap();
    }

    /* --- LOGIKA PRASYARAT KETAT --- */
    function evaluasiPrasyaratKuis() {
        const siap = stMateri && stLKM && stLatihan;
        document.getElementById('btn-dash-kuis').disabled = !siap;
        document.getElementById('dash-kuis-status').className = siap ? "status-badge complete" : "status-badge pending";
        document.getElementById('dash-kuis-status').innerText = siap ? "Terbuka ✅" : "Terkunci 🔒";
        
        if (siap) {
            document.getElementById('prereq-banner').style.borderColor = "var(--success)";
            document.getElementById('prereq-banner').style.background = "rgba(16, 185, 129, 0.1)";
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

    /* --- SIMULASI MATERI CANVAS --- */
    function nilaiKeXMateri(val) {
        return 50 + ((val - MIN_VAL) / (MAX_VAL - MIN_VAL)) * (canvasMateri.width - 100);
    }

    function gambarMateri() {
        if (!ctxMateri) return;
        ctxMateri.clearRect(0, 0, canvasMateri.width, canvasMateri.height);
        const y = canvasMateri.height / 2 + 10;

        ctxMateri.strokeStyle = "#475569"; ctxMateri.lineWidth = 4;
        ctxMateri.beginPath(); ctxMateri.moveTo(30, y); ctxMateri.lineTo(canvasMateri.width - 30, y); ctxMateri.stroke();

        for (let v = MIN_VAL; v <= MAX_VAL; v++) {
            const x = nilaiKeXMateri(v);
            ctxMateri.beginPath(); ctxMateri.moveTo(x, y - 6); ctxMateri.lineTo(x, y + 6); ctxMateri.stroke();
            ctxMateri.fillStyle = (v === 0) ? "#f59e0b" : "#94a3b8";
            ctxMateri.font = (v === 0) ? "bold 12px sans-serif" : "10px sans-serif";
            ctxMateri.textAlign = "center";
            ctxMateri.fillText(v.toString(), x, y + 22);
        }

        const xMaskot = nilaiKeXMateri(posMateri);
        ctxMateri.font = "28px sans-serif"; ctxMateri.textAlign = "center";
        ctxMateri.fillText("🚀", xMaskot, y - 25);
    }

    function langkahMateri(arah) {
        if (posMateri + arah >= MIN_VAL && posMateri + arah <= MAX_VAL) {
            posMateri += arah;
            document.getElementById('lbl-materi-pos').innerText = `📍 Posisi Sekarang: ${posMateri}`;
            gambarMateri();
        }
    }

    function resetMateri() {
        posMateri = 0;
        document.getElementById('lbl-materi-pos').innerText = `📍 Posisi Sekarang: 0`;
        gambarMateri();
    }

    /* --- LKM DIGITAL: SIMPAN SEMUA JAWABAN DAN KUMPULKAN --- */
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

    function kunciLKM(nomor = nomorAbsen, nama = namaSiswa) {
        return `lkm_submissions_${String(nomor).trim()}_${String(nama).toLowerCase().trim().replace(/\s+/g, '_')}`;
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
        if (!jawaban.some(item => item.jawaban)) {
            alert("⚠️ Isi setidaknya satu jawaban LKM sebelum dikumpulkan.");
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
        // Simpan salinan lokal sebagai cadangan, tetapi Google Sheets menjadi sumber bersama lintas perangkat.
        const semua = JSON.parse(localStorage.getItem('lkm_submissions') || '[]');
        const idx = semua.findIndex(item => String(item.absen) === String(nomorAbsen) && String(item.nama).toLowerCase() === namaSiswa.toLowerCase());
        if (idx >= 0) semua[idx] = dataLKM; else semua.push(dataLKM);
        localStorage.setItem('lkm_submissions', JSON.stringify(semua));
        localStorage.setItem(kunciLKM(), JSON.stringify(dataLKM));

        const tombol = document.querySelector('button[onclick="kumpulkanLKM()"]');
        if (tombol) { tombol.disabled = true; tombol.textContent = '⏳ Mengirim LKM...'; }
        try {
            await kirimLKMKeGoogleSheets(dataLKM);
            stLKM = true;
            document.getElementById('st-lkm').className = "status-badge complete";
            document.getElementById('st-lkm').innerText = "Selesai ✅";
            document.getElementById('dash-lkm-status').className = "status-badge complete";
            document.getElementById('dash-lkm-status').innerText = "Selesai ✅";
            simpanNilaiKeStorage();
            evaluasiPrasyaratKuis();
            alert("🎉 LKM berhasil dikirim dan diverifikasi di Google Sheets. Guru sekarang dapat melihat jawaban ini dari perangkat lain.");
            switchTab('latihan');
        } catch (err) {
            alert("⚠️ LKM tersimpan sebagai cadangan di browser ini, tetapi belum terverifikasi di Google Sheets.\n\n" + err.message + "\n\nJangan tutup halaman dulu. Periksa URL Apps Script dan coba kumpulkan kembali.");
        } finally {
            if (tombol) { tombol.disabled = false; tombol.textContent = '🎯 Kumpulkan LKM Digital'; }
        }
    }

    /* --- LATIHAN HOTS SIMULATION --- */
    function nilaiKeXLatihan(val) {
        return 50 + ((val - MIN_VAL) / (MAX_VAL - MIN_VAL)) * (canvasLatihan.width - 100);
    }

    function generateSoalLatihanBaru() {
        const idx = Math.floor(Math.random() * templatesSoalHots.length);
        soalLatihanAktif = templatesSoalHots[idx].gen();
        posLatihan = 0;
        stepArrowsLatihan = [];
        document.getElementById('input-angka-latihan').value = "";
        document.getElementById('lbl-latihan-soal').innerText = soalLatihanAktif.teks;
        document.getElementById('lbl-latihan-pos').innerText = `📍 Posisi Garis Bilangan: ${posLatihan}`;
        document.getElementById('box-pembahasan-latihan').style.display = "none";
        gambarLatihan();
    }

    function gambarLatihan() {
        if (!ctxLatihan) return;
        ctxLatihan.clearRect(0, 0, canvasLatihan.width, canvasLatihan.height);
        const y = canvasLatihan.height / 2 + 15;

        ctxLatihan.strokeStyle = "#475569"; ctxLatihan.lineWidth = 4;
        ctxLatihan.beginPath(); ctxLatihan.moveTo(30, y); ctxLatihan.lineTo(canvasLatihan.width - 30, y); ctxLatihan.stroke();

        for (let v = MIN_VAL; v <= MAX_VAL; v++) {
            const x = nilaiKeXLatihan(v);
            ctxLatihan.beginPath(); ctxLatihan.moveTo(x, y - 6); ctxLatihan.lineTo(x, y + 6); ctxLatihan.stroke();
            ctxLatihan.fillStyle = (v === 0) ? "#f59e0b" : "#94a3b8";
            ctxLatihan.font = (v === 0) ? "bold 12px sans-serif" : "10px sans-serif";
            ctxLatihan.textAlign = "center";
            ctxLatihan.fillText(v.toString(), x, y + 22);
        }

        stepArrowsLatihan.forEach((arr, i) => {
            const x0 = nilaiKeXLatihan(arr.dari);
            const x1 = nilaiKeXLatihan(arr.ke);
            const yPos = y - (25 + (i % 3) * 12);
            ctxLatihan.strokeStyle = arr.warna; ctxLatihan.lineWidth = 3;
            ctxLatihan.beginPath(); ctxLatihan.moveTo(x0, yPos); ctxLatihan.lineTo(x1, yPos); ctxLatihan.stroke();
        });

        const xMaskot = nilaiKeXLatihan(posLatihan);
        ctxLatihan.font = "28px sans-serif"; ctxLatihan.textAlign = "center";
        ctxLatihan.fillText("🚀", xMaskot, y - 25);
    }

    function langkahLatihan(arah) {
        const baru = posLatihan + arah;
        if (baru < MIN_VAL || baru > MAX_VAL) return;
        stepArrowsLatihan.push({ dari: posLatihan, ke: baru, warna: arah > 0 ? "#10b981" : "#ef4444" });
        posLatihan = baru;
        document.getElementById('lbl-latihan-pos').innerText = `📍 Posisi Garis Bilangan: ${posLatihan}`;
        gambarLatihan();
    }

    function resetLatihan() {
        posLatihan = 0;
        stepArrowsLatihan = [];
        document.getElementById('lbl-latihan-pos').innerText = `📍 Posisi Garis Bilangan: 0`;
        gambarLatihan();
    }

    function cekJawabanLatihan() {
        const inputVal = parseInt(document.getElementById('input-angka-latihan').value);
        if (isNaN(inputVal)) {
            alert("⚠️ Masukkan terlebih dahulu jawaban angka kamu!");
            return;
        }

        const box = document.getElementById('box-pembahasan-latihan');
        box.style.display = "block";

        if (inputVal === soalLatihanAktif.target && posLatihan === soalLatihanAktif.target) {
            document.getElementById('lbl-latihan-status-txt').innerText = "🥳 Sempurna! Jawaban Angka & Garis Bilangan Benar!";
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

    /* --- KUIS ENGINE --- */
    function mulaiKuisSpesifik(jenis) {
        if (!evaluasiPrasyaratKuis()) return;
        modeAktif = jenis;
        sedangMengerjakanKuis = true;
        skor = 0; indeksSoal = 0;
        daftarSoalSesi = (modeAktif === 'langsung') ? bankSoalLangsung : bankSoalKontekstual;

        document.getElementById('quiz-body').style.display = 'block';
        document.getElementById('quiz-result').style.display = 'none';
        document.getElementById('lbl-mode').innerText = (modeAktif === 'langsung') ? "⚡ Hitung Biasa" : "🌍 Soal Cerita";
        
        switchTab('kuis');
        tampilkanSoalKuis();
    }

    function nilaiKeX(val) {
        return 50 + ((val - MIN_VAL) / (MAX_VAL - MIN_VAL)) * (canvas.width - 100);
    }

    function nilaiKeY(val) {
        const topY = 40, bottomY = canvas.height - 40;
        return topY + ((MAX_VAL - val) / (MAX_VAL - MIN_VAL)) * (bottomY - topY);
    }

    function gambarKuis() {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (soalAktif && soalAktif.vertikal) {
            const x = canvas.width / 2;
            const topY = 40, bottomY = canvas.height - 40;

            ctx.strokeStyle = "#64748b"; ctx.lineWidth = 6;
            ctx.beginPath(); ctx.moveTo(x, topY); ctx.lineTo(x, bottomY); ctx.stroke();

            for (let v = MIN_VAL; v <= MAX_VAL; v++) {
                const y = nilaiKeY(v);
                ctx.strokeStyle = (v === 0) ? "#f59e0b" : "#475569";
                ctx.lineWidth = (v === 0) ? 3 : 2;
                ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.stroke();

                ctx.fillStyle = (v === 0) ? "#f59e0b" : "#94a3b8";
                ctx.font = (v === 0) ? "bold 13px sans-serif" : "11px sans-serif";
                ctx.textAlign = "left";
                ctx.fillText(v.toString(), x + 20, y + 4);
            }

            const yMaskot = nilaiKeY(posisiSekarang);
            ctx.font = "32px sans-serif"; ctx.textAlign = "center";
            ctx.fillText("🚀", x - 45, yMaskot + 10);
        } else {
            const y = canvas.height / 2 + 10;
            ctx.strokeStyle = "#475569"; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(canvas.width - 30, y); ctx.stroke();

            for (let v = MIN_VAL; v <= MAX_VAL; v++) {
                const x = nilaiKeX(v);
                ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6); ctx.stroke();
                ctx.fillStyle = (v === 0) ? "#f59e0b" : "#94a3b8";
                ctx.font = (v === 0) ? "bold 12px sans-serif" : "10px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(v.toString(), x, y + 22);
            }

            const xMaskot = nilaiKeX(posisiSekarang);
            ctx.font = "28px sans-serif"; ctx.textAlign = "center";
            ctx.fillText("🚀", xMaskot, y - 25);
        }
    }

    function tampilkanSoalKuis() {
        soalAktif = daftarSoalSesi[indeksSoal];
        posisiSekarang = 0;
        document.getElementById('input-angka-kuis').value = "";
        document.getElementById('lbl-progress').innerText = `Soal: ${indeksSoal + 1} / ${TOTAL_SOAL}`;
        document.getElementById('lbl-soal').innerText = soalAktif.teks;
        document.getElementById('lbl-posisi').innerText = `📍 Posisi Garis Bilangan: ${posisiSekarang}`;
        
        document.getElementById('panel-kontrol').innerHTML = `
            <button class="btn btn-danger" onclick="langkahKuis(-1)">⬅️ Kiri/Turun (-1)</button>
            <button class="btn btn-success" onclick="langkahKuis(1)">➡️ Kanan/Naik (+1)</button>
            <button class="btn btn-panel" onclick="resetKuis()">🔄 Reset</button>
            <button class="btn btn-accent" onclick="kunciJawabanKuis()">🎯 Kunci Jawaban</button>
        `;
        gambarKuis();
    }

    function langkahKuis(arah) {
        if (posisiSekarang + arah >= MIN_VAL && posisiSekarang + arah <= MAX_VAL) {
            posisiSekarang += arah;
            document.getElementById('lbl-posisi').innerText = `📍 Posisi Garis Bilangan: ${posisiSekarang}`;
            gambarKuis();
        }
    }

    function resetKuis() {
        posisiSekarang = 0;
        document.getElementById('lbl-posisi').innerText = `📍 Posisi Garis Bilangan: 0`;
        gambarKuis();
    }

    function kunciJawabanKuis() {
        const inputVal = parseInt(document.getElementById('input-angka-kuis').value);
        if (isNaN(inputVal)) {
            alert("⚠️ Masukkan jawaban angka terlebih dahulu!");
            return;
        }

        if (inputVal === soalAktif.target && posisiSekarang === soalAktif.target) {
            skor += 10;
            document.getElementById('lbl-emoji').innerText = "🥳";
            document.getElementById('lbl-pesan').innerText = "Sempurna! Jawaban Angka & Garis Bilangan Tepat! (+10 Poin)";
        } else {
            document.getElementById('lbl-emoji').innerText = "🧐";
            document.getElementById('lbl-pesan').innerText = `Kurang Tepat. Jawaban Benar adalah ${soalAktif.target}`;
        }

        const tombolLanjut = (indeksSoal < TOTAL_SOAL - 1)
            ? `<button class="btn btn-primary" style="grid-column: span 4;" onclick="lanjutKuis()">➡️ Soal Selanjutnya</button>`
            : `<button class="btn btn-accent" style="grid-column: span 4;" onclick="selesaiKuis()">📊 Lihat Hasil Akhir</button>`;

        document.getElementById('panel-kontrol').innerHTML = tombolLanjut;
    }

    function lanjutKuis() {
        indeksSoal++;
        tampilkanSoalKuis();
    }

    function selesaiKuis() {
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

    /* --- REKAP GURU --- */
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
        tbody.innerHTML = '<tr><td colspan="8">⏳ Memuat data nilai dan LKM dari Google Sheets...</td></tr>';
        let riwayatNilai = JSON.parse(localStorage.getItem('rekap_nilai_smp') || '[]');
        let dataLKMOnline = [];
        try {
            if (!teacherPinSession) throw new Error("Sesi guru berakhir. Buka kembali Rekap Guru dan masukkan PIN.");
            const remote = await sheetsJsonp({ action: "listLKM", pin: teacherPinSession });
            dataLKMOnline = Array.isArray(remote.data) ? remote.data : [];
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="8">Gagal memuat LKM online: ${escapeHTML(err.message)}. Periksa koneksi, URL Apps Script, dan izin deployment.</td></tr>`;
            return;
        }

        // Gabungkan rekap nilai lokal (jika ada) dengan pengumpulan LKM online.
        const map = new Map();
        riwayatNilai.forEach(r => map.set(`${String(r.absen).trim()}|${String(r.nama).toLowerCase().trim()}`, { ...r }));
        dataLKMOnline.forEach(l => {
            const key = `${String(l.absen).trim()}|${String(l.nama).toLowerCase().trim()}`;
            const existing = map.get(key) || { absen: l.absen, nama: l.nama, langsung: null, kontekstual: null, lkmStatus: "Belum", waktu: "-" };
            existing.lkmStatus = l.status || "Dikumpulkan";
            existing.lkmWaktu = l.waktuLokal || l.waktu || "-";
            existing.lkmOnline = true;
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
                    <td><span class="status-badge ${hasLKM ? 'complete' : 'pending'}">${hasLKM ? 'Dikumpulkan ✅' : escapeHTML(r.lkmStatus || 'Belum')}</span></td>
                    <td>${escapeHTML(n1)}</td><td>${escapeHTML(n2)}</td>
                    <td style="color: var(--accent); font-weight:700;">${escapeHTML(rata)}</td>
                    <td style="font-size: 0.8rem; color: var(--text-muted);">${escapeHTML(lkmWaktu)}</td>
                    <td>${hasLKM ? `<button class="btn btn-success" onclick="unduhLKMpdf(${JSON.stringify(String(r.absen))}, ${JSON.stringify(String(r.nama))})">📄 Unduh LKM PDF</button>` : '<span>Belum ada LKM</span>'}</td>
                </tr>`;
        });
    }

    function escapeHTML(value) {
        return String(value ?? '-').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }

    // Versi lama (dialog cetak browser) dipertahankan sebagai cadangan.
    async function unduhLKMpdfCetak(absen, nama) {
        // Buka jendela langsung dari klik pengguna agar browser tidak memblokir pop-up setelah proses async.
        const win = window.open('', '_blank');
        if (!win) {
            alert("Jendela PDF diblokir browser. Izinkan pop-up untuk situs ini lalu tekan tombol Unduh LKM PDF lagi.");
            return;
        }
        win.document.write('<p style="font-family:Arial;padding:24px">⏳ Mengambil jawaban LKM dari Google Sheets...</p>');
        try {
            if (!teacherPinSession) throw new Error("Sesi guru tidak tersedia. Masuk kembali ke Rekap Guru.");
            const remote = await sheetsJsonp({ action: "listLKM", pin: teacherPinSession });
            const data = (remote.data || []).find(item => String(item.absen) === String(absen) && String(item.nama).toLowerCase() === String(nama).toLowerCase());
            if (!data) throw new Error("Jawaban LKM siswa tidak ditemukan di Google Sheets.");
            const rows = (data.jawaban || []).map((item, i) => `<tr><td>${i + 1}</td><td>${escapeHTML(item.pertanyaan || item.id)}</td><td>${escapeHTML(item.jawaban || '(Belum diisi)')}</td></tr>`).join('');
            const doc = `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>LKM - ${escapeHTML(data.nama)}</title>
            <style>body{font-family:Arial,sans-serif;color:#172033;margin:28px;line-height:1.45}h1{font-size:20px;margin-bottom:4px}p{margin:5px 0}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #9ca3af;padding:8px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#e5e7eb}.meta{margin-top:14px}@media print{body{margin:12mm}}</style></head><body>
            <h1>LEMBAR KERJA PESERTA DIDIK (LKM)</h1><p><b>MathQuest SMP Kelas VII — Bilangan Bulat</b></p>
            <div class="meta"><p><b>Nama siswa:</b> ${escapeHTML(data.nama)}</p><p><b>Nomor absen:</b> ${escapeHTML(data.absen)}</p><p><b>Status:</b> ${escapeHTML(data.status)}</p><p><b>Waktu pengumpulan:</b> ${escapeHTML(data.waktuLokal || data.waktu || '-')}</p></div>
            <table><thead><tr><th style="width:5%">No.</th><th style="width:43%">Pertanyaan / Bagian</th><th>Jawaban siswa</th></tr></thead><tbody>${rows}</tbody></table>
            <p style="margin-top:24px">Catatan guru: ______________________________________________________________</p>
            <script>window.onload=()=>{setTimeout(()=>window.print(),500)};<\/script></body></html>`;
            win.document.open(); win.document.write(doc); win.document.close();
        } catch (err) {
            win.document.body.innerHTML = `<p style="font-family:Arial;padding:24px;color:#b91c1c">Gagal mengambil LKM: ${escapeHTML(err.message)}</p>`;
        }
    }

    // Bersihkan karakter yang tidak didukung font bawaan PDF (Latin-1), tanpa mengubah data asli.
    function bersihkanUntukPDF(value) {
        const peta = { '−':'-','–':'-','—':'-','×':'x','÷':'/','√':'akar ','≤':'<=','≥':'>=','≠':'!=','≈':'~','π':'pi',
            '“':'"','”':'"','‘':"'",'’':"'",'…':'...','→':'->','←':'<-','⁰':'^0','¹':'^1','⁴':'^4','⁵':'^5','⁶':'^6','⁷':'^7','⁸':'^8','⁹':'^9' };
        return String(value ?? '')
            .replace(/\r\n?/g, '\n')
            .replace(/[^\u0000-\u00FF]/g, ch => peta[ch] !== undefined ? peta[ch] : '')
            .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, '')
            .replace(/[ \t]+\n/g, '\n').trim();
    }

    // ===== Pembuat PDF mandiri (tanpa library/CDN eksternal) =====
    let _pdfCanvasCtx = null;
    function ukurTeksPDF(teks, size, bold) {
        try {
            if (!_pdfCanvasCtx && typeof document !== 'undefined') _pdfCanvasCtx = document.createElement('canvas').getContext('2d');
            if (_pdfCanvasCtx) {
                _pdfCanvasCtx.font = `${bold ? 'bold ' : ''}${size}px Helvetica, Arial, sans-serif`;
                return _pdfCanvasCtx.measureText(teks).width;
            }
        } catch (_) {}
        return teks.length * size * 0.52;
    }

    function bungkusTeksPDF(teks, lebar, size, bold) {
        const hasil = [];
        String(teks).split('\n').forEach(para => {
            if (para === '') { hasil.push(''); return; }
            let baris = '';
            para.split(' ').forEach(kata => {
                let coba = baris ? baris + ' ' + kata : kata;
                if (ukurTeksPDF(coba, size, bold) <= lebar) { baris = coba; return; }
                if (baris) { hasil.push(baris); baris = ''; }
                // kata panjang: potong per karakter
                while (ukurTeksPDF(kata, size, bold) > lebar && kata.length > 1) {
                    let n = kata.length;
                    while (n > 1 && ukurTeksPDF(kata.slice(0, n), size, bold) > lebar) n--;
                    hasil.push(kata.slice(0, n)); kata = kata.slice(n);
                }
                baris = kata;
            });
            hasil.push(baris);
        });
        return hasil;
    }

    function buatPDFLKM(data) {
        const W = 595.28, H = 841.89, M = 42, FS = 9.5, LH = 13, PAD = 5;
        const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
        const halaman = [];
        let ops = [], y = M;
        const hal = () => { ops = []; halaman.push(ops); y = M; };
        const teks = (t, x, yTop, size, bold) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${(H - yTop - size * 0.8).toFixed(2)} Td (${esc(t)}) Tj ET`);
        const kotak = (x, yTop, w, h, isi) => ops.push(`${isi ? '0.898 0.906 0.922 rg' : ''} 0.612 0.639 0.686 RG 0.6 w ${x.toFixed(2)} ${(H - yTop - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${isi ? 'B' : 'S'} 0 g`);
        hal();

        teks('LEMBAR KERJA PESERTA DIDIK (LKM)', M, y, 15, true); y += 22;
        teks('MathQuest SMP Kelas VII - Bilangan Bulat', M, y, 11, true); y += 24;
        [['Nama siswa', data.nama], ['Nomor absen', data.absen], ['Status', data.status], ['Waktu pengumpulan', data.waktuLokal || data.waktu || '-']]
            .forEach(([k, v]) => { teks(k + ':', M, y, 10, true); teks(bersihkanUntukPDF(v) || '-', M + 115, y, 10, false); y += 15; });
        y += 10;

        const kolW = [30, 170, W - 2 * M - 200];
        const kolX = [M, M + kolW[0], M + kolW[0] + kolW[1]];
        const gambarHead = () => {
            const h = LH + 2 * PAD;
            ['No.', 'Pertanyaan / Bagian', 'Jawaban siswa'].forEach((t, i) => { kotak(kolX[i], y, kolW[i], h, true); teks(t, kolX[i] + PAD, y + PAD, FS, true); });
            y += h;
        };
        gambarHead();

        const baris = (data.jawaban || []).map((it, i) => [
            [String(i + 1)],
            bungkusTeksPDF(bersihkanUntukPDF(it.pertanyaan || it.id) || '-', kolW[1] - 2 * PAD, FS, false),
            bungkusTeksPDF(bersihkanUntukPDF(it.jawaban) || '(Belum diisi)', kolW[2] - 2 * PAD, FS, false)
        ]);
        baris.forEach(kol => {
            const total = Math.max(kol[0].length, kol[1].length, kol[2].length);
            let mulai = 0;
            while (mulai < total) {
                let sisa = Math.floor((H - M - y - 2 * PAD) / LH);
                if (sisa < 1) { hal(); gambarHead(); sisa = Math.floor((H - M - y - 2 * PAD) / LH); }
                const n = Math.min(sisa, total - mulai), h = n * LH + 2 * PAD;
                for (let c = 0; c < 3; c++) {
                    kotak(kolX[c], y, kolW[c], h, false);
                    kol[c].slice(mulai, mulai + n).forEach((t, k) => { if (t) teks(t, kolX[c] + PAD, y + PAD + k * LH, FS, false); });
                }
                y += h; mulai += n;
            }
        });

        y += 22;
        if (y > H - M) hal();
        teks('Catatan guru: ' + '.'.repeat(75), M, y, 10, false);

        // Susun struktur file PDF
        const objs = [];
        const n = halaman.length;
        objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        objs[2] = `<< /Type /Pages /Kids [${halaman.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${n} >>`;
        objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
        objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
        halaman.forEach((o, i) => {
            const stream = o.join('\n');
            objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
            objs[6 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
        });
        let pdf = '%PDF-1.4\n';
        const offs = [];
        for (let i = 1; i < objs.length; i++) { offs[i] = pdf.length; pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
        const xref = pdf.length;
        pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
        for (let i = 1; i < objs.length; i++) pdf += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
        pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
        const bytes = new Uint8Array(pdf.length);
        for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xFF;
        return new Blob([bytes], { type: 'application/pdf' });
    }

    function simpanBerkas(blob, namaFile) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = namaFile; a.style.display = 'none';
        document.body.appendChild(a); a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 10000);
    }

    // Unduh LKM sebagai file PDF asli (langsung tersimpan ke folder Download).
    async function unduhLKMpdf(absen, nama) {
        const ev = window.event;
        const btn = ev && ev.target && ev.target.closest ? ev.target.closest('button') : null;
        const labelAwal = btn ? btn.innerHTML : '';
        if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Membuat PDF...'; }
        try {
            if (!teacherPinSession) throw new Error("Sesi guru tidak tersedia. Masuk kembali ke Rekap Guru.");
            const remote = await sheetsJsonp({ action: "listLKM", pin: teacherPinSession });
            const data = (remote.data || []).find(item => String(item.absen) === String(absen) && String(item.nama).toLowerCase() === String(nama).toLowerCase());
            if (!data) throw new Error("Jawaban LKM siswa tidak ditemukan di Google Sheets.");
            const aman = s => String(s).replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'siswa';
            simpanBerkas(buatPDFLKM(data), `LKM_${aman(data.absen)}_${aman(data.nama)}.pdf`);
        } catch (err) {
            alert("Gagal membuat PDF LKM: " + err.message);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = labelAwal; }
        }
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
            if(item.lkmStatus) stLKM = true;
        }
    }

    window.onload = () => {
        gambarMateri();
    };