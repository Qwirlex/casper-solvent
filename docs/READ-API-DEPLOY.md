# Read API deploy, caspersolvent.xyz/api

The dApp reads vault state and per account shares from chain through a small read API,
because a browser cannot read Casper state directly. The API is read only, holds no
keys, and reads over the public testnet node. It sits behind the site at /api via a
Caddy reverse_proxy.

## What runs

`agents/src/webApi/server.ts`, an Express server on port 4090, with two endpoints:

- `GET /api/vault` returns total assets, total shares, allocation, last decision, fee.
- `GET /api/shares/:account` returns shares for a public key hex or an account hash.

## Run it on the VPS

The repo is public, clone it on the VPS and start the API. Node 18+ is required.

```
cd /opt/caspersolvent
git clone https://github.com/Qwirlex/casper-solvent.git app || (cd app && git pull)
cd app/agents
npm install
# smoke test
WEB_API_PORT=4090 npx tsx src/webApi/server.ts &
curl -s localhost:4090/api/vault ; echo
```

Make it durable with systemd:

```
cat >/etc/systemd/system/caspersolvent-api.service <<'UNIT'
[Unit]
Description=Solvent read API
After=network.target

[Service]
WorkingDirectory=/opt/caspersolvent/app/agents
ExecStart=/usr/bin/npx tsx src/webApi/server.ts
Environment=WEB_API_PORT=4090
Restart=always
User=root

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now caspersolvent-api
systemctl status caspersolvent-api --no-pager | head
```

## Caddy route, user runs this, agent is blocked from the shared Caddy

Add one reverse_proxy line to the caspersolvent.xyz block in /opt/revertguard/Caddyfile,
inside the existing site block, do not touch the salescheduler or aegiscan blocks:

```
caspersolvent.xyz, www.caspersolvent.xyz {
    handle /api/* {
        reverse_proxy localhost:4090
    }
    handle {
        root * /data/caspersolvent
        file_server
    }
}
```

Then reload Caddy the way that works on this host, recreate the caddy container so it
rebinds the current Caddyfile:

```
cd /opt/revertguard && docker compose up -d --force-recreate caddy
```

The aegis-caddy-ensure timer re adds aegiscan within 30s, salescheduler stays up.

## Verify

```
curl -s https://caspersolvent.xyz/api/vault ; echo
curl -s https://caspersolvent.xyz/api/shares/02020f62f89d5d78d79eba973ed5a45556b1dd6e1a31c5fb9490f634394e1af1a7ad ; echo
```

Both should return JSON. The dApp then shows real on chain shares on connect and real
vault numbers in the headline, falling back silently if the API is down.
