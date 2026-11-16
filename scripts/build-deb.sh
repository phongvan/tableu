#!/usr/bin/env bash
# Dong goi .deb tu dist/linux-unpacked bang dpkg-deb.
# Dung cach nay vi fpm (cua electron-builder) doi lenh `ar` trong goi binutils;
# dpkg-deb thi Ubuntu nao cung co san.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# package.json giu semver ba so; hien thi rut gon ".0" o cuoi (xem lib/version.js)
VERSION=$(node -p "require('./lib/version').hienThi(require('./package.json').version)")
PKG=tableu
APPDIR=dist/linux-unpacked
STAGE=dist/deb-stage
OUT="dist/${PKG}_${VERSION}_amd64.deb"

[ -d "$APPDIR" ] || { echo "Chua co $APPDIR — chay: npx electron-builder --linux dir"; exit 1; }

rm -rf "$STAGE"
mkdir -p "$STAGE/opt/TableU" \
         "$STAGE/usr/bin" \
         "$STAGE/usr/share/applications" \
         "$STAGE/usr/share/icons/hicolor/512x512/apps" \
         "$STAGE/DEBIAN"

cp -a "$APPDIR"/. "$STAGE/opt/TableU/"
cp build/icon.png "$STAGE/usr/share/icons/hicolor/512x512/apps/${PKG}.png"
ln -sf /opt/TableU/tableu "$STAGE/usr/bin/${PKG}"

cat > "$STAGE/usr/share/applications/${PKG}.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=TableU
GenericName=MySQL client
Comment=Trình xem bảng và chạy truy vấn MySQL
Exec=/opt/TableU/tableu %U
Icon=tableu
Terminal=false
Categories=Development;Database;
Keywords=mysql;mariadb;database;sql;
StartupWMClass=TableU
EOF

INSTALLED_KB=$(du -sk "$STAGE/opt" "$STAGE/usr" | awk '{s+=$1} END {print s}')

# Doc tu package.json, khong ghi cung: doi tac gia hay mo ta chi sua mot cho.
MAINTAINER=$(node -p "require('./package.json').build.linux.maintainer")
HOMEPAGE=$(node -p "require('./package.json').homepage")
SYNOPSIS=$(node -p "require('./package.json').build.linux.synopsis")
# Mo ta dai trong DEBIAN/control: moi dong phai bat dau bang mot dau cach
DESC_DAI=$(node -p "
  require('./package.json').build.linux.description
    .split(/\s+/).reduce((d, t) => {
      const i = d.length - 1;
      if ((d[i] + ' ' + t).length > 74) d.push(t); else d[i] += ' ' + t;
      return d;
    }, ['']).map(l => ' ' + l.trim()).join('\n')")

cat > "$STAGE/DEBIAN/control" <<EOF
Package: ${PKG}
Version: ${VERSION}
Section: devel
Priority: optional
Architecture: amd64
Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, libatspi2.0-0, libsecret-1-0, xdg-utils
Installed-Size: ${INSTALLED_KB}
Maintainer: ${MAINTAINER}
Homepage: ${HOMEPAGE}
Description: ${SYNOPSIS}
${DESC_DAI}
EOF

# chrome-sandbox phai setuid root, neu khong Electron se bao loi SUID sandbox
cat > "$STAGE/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if [ -f /opt/TableU/chrome-sandbox ]; then
  chown root:root /opt/TableU/chrome-sandbox
  chmod 4755 /opt/TableU/chrome-sandbox
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
EOF
chmod 755 "$STAGE/DEBIAN/postinst"

dpkg-deb --root-owner-group -Zxz --build "$STAGE" "$OUT" >/dev/null
rm -rf "$STAGE"
# dong-goi.js da tong ket roi; o day chi bao khi chay truc tiep script nay
[ -n "${TABLEU_IM_LANG:-}" ] || echo "Xong: $OUT  ($(du -h "$OUT" | cut -f1))"
