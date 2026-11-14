<?php
// index.php - หน้าสุ่มแบ่งกลุ่ม 4 สี สำนักงานปลัดกระทรวงการคลัง
header("Cache-Control: no-cache, no-store, must-revalidate");
header("Pragma: no-cache");
header("Expires: 0");

require_once __DIR__ . '/parse_xlsx.php';

$userData = null;
$officialXlsxPath = __DIR__ . '/รายชื่อเจ้าหน้าที่_1793870022477.xlsx';
$officialsJsonPath = __DIR__ . '/officials_504.json';

// หากไฟล์ XLSX ใหม่กว่า JSON ให้แปลงใหม่โดยอัตโนมัติ
if (file_exists($officialXlsxPath) && (!file_exists($officialsJsonPath) || filemtime($officialXlsxPath) > filemtime($officialsJsonPath))) {
    $parsed = parseOfficialXlsx($officialXlsxPath);
    if (!empty($parsed)) {
        $userData = $parsed;
        file_put_contents($officialsJsonPath, json_encode($parsed, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    }
}

if (!$userData && file_exists($officialsJsonPath)) {
    $userData = json_decode(file_get_contents($officialsJsonPath), true);
}

if (!$userData && file_exists($officialXlsxPath)) {
    $userData = parseOfficialXlsx($officialXlsxPath);
}

if (!$userData || count($userData) === 0) {
    $jsonPath = __DIR__ . '/performance-appraisal.users19.json';
    if (file_exists($jsonPath)) {
        $userData = json_decode(file_get_contents($jsonPath), true);
    } else {
        $userData = [];
    }
}

// โหลดผลการสุ่มล่าสุด (ถ้ามี จาก stage_random หรือการสุ่มครั้งก่อน)
$latestSpin = null;
$spinPath = __DIR__ . '/latest_spin.json';
if (file_exists($spinPath)) {
    $latestSpin = json_decode(file_get_contents($spinPath), true);
}

// โหลดรูปภาพประจำตัวทั้งหมดที่มี
$userAvatars = [];
$avatarDir = __DIR__ . '/uploads/avatars/';
if (is_dir($avatarDir)) {
    foreach (scandir($avatarDir) as $f) {
        if (preg_match('/^avatar_([a-zA-Z0-9_-]+)\.([a-zA-Z0-9]+)$/', $f, $m)) {
            $userAvatars[$m[1]] = 'uploads/avatars/' . $f . '?v=' . filemtime($avatarDir . $f);
        }
    }
}

// Read index.html template
$html = file_get_contents(__DIR__ . '/index.html');

// Inject pre-loaded data script and latest spin data
$injection = "<script>\n" .
    "  window.INITIAL_USER_DATA = " . json_encode($userData, JSON_UNESCAPED_UNICODE) . ";\n" .
    "  window.LATEST_SPIN_DATA = " . json_encode($latestSpin, JSON_UNESCAPED_UNICODE) . ";\n" .
    "  window.INITIAL_USER_AVATARS = " . json_encode($userAvatars, JSON_UNESCAPED_UNICODE) . ";\n" .
"</script>";
$html = str_replace('</head>', $injection . "\n</head>", $html);

echo $html;
