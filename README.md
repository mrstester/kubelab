# KubeLab — Kubernetes Troubleshooting Simulator

A front-end training simulator for Kubernetes incident response. It runs entirely in the browser and is safe to deploy as a static Vercel site.

## What it includes
- 24 incident scenarios across Pods, Scheduling, Images, Configuration, Networking, Storage, Nodes, Security, Autoscaling, Workloads and Cluster Operations.
- Simulated `kubectl` terminal output and step-by-step investigation.
- Evidence checklist, root cause, remediation, verification commands and learning notes.
- Search and category filters, difficulty/severity labels, incident progress and a command console.
- No backend, credentials, cluster connection or real command execution.

## Run locally
Requires Node.js 18+.

```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## Deploy to Vercel
1. Upload this project to a Git repository.
2. In Vercel, select **Add New → Project** and import the repository.
3. Framework preset: **Vite**.
4. Build command: `npm run build`
5. Output directory: `dist`
6. Deploy.

`vercel.json` provides an SPA rewrite.

## Important
This is a realistic *training simulation*, not a live Kubernetes cluster. All outputs are illustrative and deterministic. The terminal accepts only the commands included in the selected scenario and displays simulated output. It does not run shell commands or connect to infrastructure. Adapt fixes to your own cluster, Kubernetes version, policies and workload before using them in production.
