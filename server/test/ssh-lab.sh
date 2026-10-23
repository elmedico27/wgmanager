#!/bin/sh
# Throwaway sshd for test/ssh.test.js. Needs root and openssh-server, and
# creates a local account named wgweb. For a disposable test machine or
# container only, never a real server.
#   sudo sh test/ssh-lab.sh /tmp/wgm-lab
#   WGM_SSH_LAB=/tmp/wgm-lab npm test
set -eu
LAB=${1:?usage: ssh-lab.sh DIR}
mkdir -p "$LAB"
id wgweb >/dev/null 2>&1 || useradd -m -s /bin/sh wgweb
usermod -p '*' wgweb
for k in host_ed25519 other_host app_key stranger_key; do
  [ -f "$LAB/$k" ] || ssh-keygen -q -t ed25519 -N '' -C '' -f "$LAB/$k"
done
mkdir -p /etc/wgm-lab
cp "$LAB/app_key.pub" /etc/wgm-lab/authorized_keys
chmod 644 /etc/wgm-lab/authorized_keys
# Answers like the helper (protocol 1) for a few fixed requests.
cat > /etc/wgm-lab/fake-helper <<'EOF'
#!/bin/sh
case "$SSH_ORIGINAL_COMMAND" in
  version) echo '{"ok":true,"protocol":1,"data":{"helper_version":"0.1.4","protocol":1,"backend":"pivpn","interface":"wg0","pivpn_scripts":{}}}' ;;
  list) echo '{"ok":true,"protocol":1,"data":{"interface":{"name":"wg0","up":true,"public_key":"xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=","listen_port":51820},"clients":[{"name":"Alice_Phone","public_key":"yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=","address":"10.0.0.2","created_at":1779754272,"enabled":true,"live":true,"manageable":true,"endpoint":null,"latest_handshake":null,"transfer_rx":0,"transfer_tx":0}],"warnings":[]}}' ;;
  "get-config Alice_Phone") printf '{"ok":true,"protocol":1,"data":{"name":"Alice_Phone","config":"[Interface]\\nPrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=\\nAddress = 10.0.0.2/24\\n"}}\n' ;;
  "get-config Bob_Phone") echo '{"ok":false,"protocol":1,"error":{"code":"not_found","message":"client not found"}}'; exit 3 ;;
  slow) sleep 30 ;;
  *) echo "{\"got\":\"$SSH_ORIGINAL_COMMAND\"}"; exit 2 ;;
esac
EOF
chmod 755 /etc/wgm-lab/fake-helper
cat > "$LAB/sshd_config" <<EOF
Port 2222
ListenAddress 127.0.0.1
HostKey $LAB/host_ed25519
PidFile $LAB/sshd.pid
AuthorizedKeysFile /etc/wgm-lab/authorized_keys
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
StrictModes no
Match User wgweb
  ForceCommand /etc/wgm-lab/fake-helper
  DisableForwarding yes
  PermitTTY no
EOF
mkdir -p /run/sshd
[ -f "$LAB/sshd.pid" ] && kill "$(cat "$LAB/sshd.pid")" 2>/dev/null || true
/usr/sbin/sshd -f "$LAB/sshd_config" -E "$LAB/sshd.log"
echo "lab sshd on 127.0.0.1:2222 (WGM_SSH_LAB=$LAB)"
