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

## Status

The VPS service is already deployed and running. Cloned to /opt/caspersolvent/app,
npm installed, and started as the systemd unit caspersolvent-api on port 4090. Verified
with curl localhost:4090/api/vault returning real chain state. To update it later, cd
/opt/caspersolvent/app && git pull && systemctl restart caspersolvent-api.

The only step left is the Caddy route, which the agent cannot touch on the shared Caddy.

## Caddy route, user runs this, agent is blocked from the shared Caddy

The current block in /opt/revertguard/Caddyfile is:

```
caspersolvent.xyz, www.caspersolvent.xyz {
	root * /data/caspersolvent
	encode gzip
	file_server
}
```

Replace it with this, which routes /api/* to the read API and serves the static site
for everything else. Do not touch the salescheduler or aegiscan blocks:

```
caspersolvent.xyz, www.caspersolvent.xyz {
	handle /api/* {
		reverse_proxy 172.18.0.1:4090
	}
	handle {
		root * /data/caspersolvent
		encode gzip
		file_server
	}
}
```

The upstream is 172.18.0.1:4090, not localhost. Caddy runs in a container, so localhost
there is the container itself, not the host. 172.18.0.1 is the revertguard_default
network gateway, which is the host as seen from the container, verified reachable from
the caddy container. If the docker network is ever recreated and the gateway changes,
read it with `docker inspect revertguard-caddy-1 --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}'`.

Then recreate the caddy container so it rebinds the current Caddyfile:

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
