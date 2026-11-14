# สุ่มแบ่งกลุ่ม 4 สี — deployment

Two supported targets, same image:

- `deploy/k8s/` — Kubernetes (production)
- `docker-compose.yml` — single Ubuntu VPS with Docker Compose (fallback / staging)

---

## 1. Build the image

```bash
docker build -t sport-spin:1.0.0 .
```

Image contents: static pages (`index.html`, `stage_random.html`, `img/`, `uploads/photos/`),
the JSON data the pages fetch, `api/*.js` handlers and `server.cjs`.
PHP sources, `dev/`, `scripts/`, `deploy/` and `*.xlsx` are excluded by `.dockerignore`.

Push it to your registry (edit the name in `deploy/k8s/kustomization.yaml`):

```bash
docker tag sport-spin:1.0.0 registry.example.go.th/mof/sport-spin:1.0.0
docker push registry.example.go.th/mof/sport-spin:1.0.0
```

For a private registry create the pull secret once:

```bash
kubectl -n sport-spin create secret docker-registry regcred \
  --docker-server=registry.example.go.th \
  --docker-username=... --docker-password=...
# then add to the pod spec:
#   imagePullSecrets:
#     - name: regcred
```

---

## 2. Deploy on Kubernetes

```bash
# 1) point the image + host at your values
#    deploy/k8s/kustomization.yaml  -> images[0].newName / newTag
#    deploy/k8s/ingress.yaml        -> spec.rules[0].host, tls.hosts
#    deploy/k8s/pvc.yaml            -> storageClassName (local-path on k3s, gp3 on EKS, ...)

kubectl apply -k deploy/k8s
kubectl -n sport-spin rollout status deploy/sport-spin --timeout=180s
kubectl -n sport-spin get pods,svc,ingress,pvc
```

Quick access without an ingress:

```bash
kubectl -n sport-spin port-forward svc/sport-spin 8080:80
# http://localhost:8080
```

Prereqs on the cluster: Traefik (k3s ships it by default, `ingressClassName: traefik`) and,
for automatic certificates, cert-manager with a `letsencrypt-prod` ClusterIssuer. Both lines in
`ingress.yaml` (`ingressClassName`, cert-manager annotation) are safe to change or remove.

### What the manifests enforce

| Item | Value |
| --- | --- |
| Container user | `1000:1000` (the image's `node` user), `runAsNonRoot` |
| Root filesystem | read-only, only `/var/lib/sport-state` (PVC) and `/tmp` (emptyDir 32Mi) are writable |
| Capabilities | all dropped, `allowPrivilegeEscalation: false`, `seccompProfile: RuntimeDefault` |
| Namespace | `pod-security.kubernetes.io/enforce: restricted` |
| Service account | token not mounted |
| Probes | startup `/healthz`, readiness `/readyz` (checks the state volume is writable), liveness `/healthz` |
| Resources | requests 50m / 128Mi, limits 1 CPU / 512Mi |
| Rollout | `Recreate` + `preStop sleep 5` so the state volume is released before the new pod starts |

### Scaling

`replicas: 1` on purpose. `sport-state` is a `ReadWriteOnce` volume holding the saved draw
(`latest_spin.json`) and uploaded avatars, and the app assumes a single writer. To run more
replicas you must move that state off the volume (object storage / a database) or use a
`ReadWriteMany` class, then switch `strategy` to `RollingUpdate`.

### Update and rollback

```bash
kubectl -n sport-spin set image deploy/sport-spin web=registry.example.go.th/mof/sport-spin:1.0.1
kubectl -n sport-spin rollout status deploy/sport-spin

kubectl -n sport-spin rollout undo deploy/sport-spin          # previous ReplicaSet
kubectl -n sport-spin rollout history deploy/sport-spin
```

### Backup the state

```bash
kubectl -n sport-spin exec deploy/sport-spin -- sh -c 'cat /var/lib/sport-state/latest_spin.json' > backup-$(date +%F).json
```

---

## 3. Fallback: single VPS with Docker Compose

```bash
# on the Ubuntu VPS
bash deploy/vps/bootstrap-vps.sh          # docker, ufw 22/80/443, /opt/sport-spin
cd /opt/sport-spin
cp .env.example .env                      # DOMAIN + ACME_EMAIL
docker compose up -d --build              # app on 127.0.0.1:8080
docker compose --profile edge up -d       # Traefik on 80/443 with automatic TLS
```

Health, logs, state:

```bash
curl -fsS http://127.0.0.1:8080/healthz
docker compose logs -f web
docker run --rm -v sport-spin_sport-state:/s alpine cat /s/latest_spin.json
```

---

## 4. Runtime contract

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | listen port |
| `HOST` | `0.0.0.0` | listen address |
| `STATE_DIR` | `/var/lib/sport-state` in the image (`/tmp/sport-state` outside it) | writable dir for `latest_spin.json` and `avatars/` |

Endpoints: `/healthz`, `/readyz`, `/api/save_state` (GET/POST), `/api/upload_avatar`
(`?action=list|delete`, POST upload), `/uploads/avatars/<file>`, plus the static pages.
`/api/*` bodies over 25 MB are rejected with 413.