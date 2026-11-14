@echo off
chcp 65001 >nul
echo ========================================================
echo   ระบบรีเซ็ตรหัสผ่าน PostgreSQL 18 อัตโนมัติ (เป็น 1234)
echo ========================================================
echo.

:: ตรวจสอบสิทธิ์ Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [คำเตือน] กรุณาคลิกขวาที่ไฟล์นี้ แล้วเลือก "Run as administrator" ครับ
    echo.
    pause
    exit /b
)

echo [1/5] กำลังหยุดการทำงานของ PostgreSQL 18...
net stop postgresql-x64-18 >nul 2>&1

echo [2/5] กำลังปลดล็อคสิทธิ์ชั่วคราว (Trust Mode)...
powershell -NoProfile -Command "(Get-Content 'C:\Program Files\PostgreSQL\18\data\pg_hba.conf') -replace 'scram-sha-256', 'trust' | Set-Content 'C:\Program Files\PostgreSQL\18\data\pg_hba.conf'"

echo [3/5] กำลังเริ่มการทำงานของ PostgreSQL 18...
net start postgresql-x64-18

echo [4/5] กำลังตั้งรหัสผ่านใหม่เป็น 1234...
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "ALTER USER postgres WITH PASSWORD '1234';"

echo [5/5] กำลังคืนค่าความปลอดภัยระบบ...
powershell -NoProfile -Command "(Get-Content 'C:\Program Files\PostgreSQL\18\data\pg_hba.conf') -replace 'trust', 'scram-sha-256' | Set-Content 'C:\Program Files\PostgreSQL\18\data\pg_hba.conf'"
"C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" reload -D "C:\Program Files\PostgreSQL\18\data" >nul 2>&1

echo.
echo ========================================================
echo   [สำเร็จ!] รีเซ็ตรหัสผ่านเสร็จเรียบร้อย
echo   User: postgres
echo   Password: 1234
echo ========================================================
echo.
pause

