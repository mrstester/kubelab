import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, AlertCircle, ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, Command, Copy, Cpu, Database, Filter, Gauge, HardDrive, Layers3, LifeBuoy, Network, Play, RotateCcw, Search, Server, ShieldAlert, Terminal, X } from "lucide-react";
import "./styles.css";

const incidents = [
{
 id:"crashloop", title:"CrashLoopBackOff", category:"Pods & Containers", severity:"High", level:"Beginner", symptom:"Container repeatedly starts and exits.", tags:["logs","container","restart"],
 summary:"The application process exits shortly after startup. Kubernetes restarts it with increasing back-off delays.",
 first:"kubectl get pods -n production",
 output:`NAME                        READY   STATUS             RESTARTS   AGE\napi-7d9c8f6b5d-k2m4p        0/1     CrashLoopBackOff   7          18m`,
 steps:[
  {title:"Inspect pod events and last state",cmd:"kubectl describe pod api-7d9c8f6b5d-k2m4p -n production",out:`Last State:     Terminated\nReason:         Error\nExit Code:      1\nRestart Count:  7\nEvents:\n  Warning  BackOff  kubelet  Back-off restarting failed container`},
  {title:"Read the previous container logs",cmd:"kubectl logs api-7d9c8f6b5d-k2m4p -n production --previous",out:`2026-10-16T09:12:11Z starting api service\nFATAL: required environment variable DATABASE_URL is not set\nprocess exited with code 1`},
  {title:"Inspect configuration references",cmd:"kubectl describe deployment api -n production",out:`Environment:\n  DATABASE_URL:  <set to the key 'DATABASE_URL' in secret 'api-config'> Optional: false\nWarning: secret "api-config" not found` }
 ],
 cause:"The Deployment references a missing Secret named api-config. The application exits because DATABASE_URL is unavailable.",
 fix:"Create or restore the expected Secret in the production namespace, verify the key name, and ensure the Deployment references it correctly. Do not put credentials directly in a manifest or commit them to Git.",
 verify:"kubectl rollout status deployment/api -n production\nkubectl get pods -n production\nkubectl logs deployment/api -n production --tail=100",
 lesson:"CrashLoopBackOff is a symptom, not a root cause. Start with describe + previous logs; inspect exit code, events, configuration, probes and recent rollout history."
},
{
 id:"pending",title:"Pod stuck Pending",category:"Scheduling & Resources",severity:"High",level:"Beginner",symptom:"Pod has not been assigned to a node.",tags:["scheduler","memory","requests"],
 summary:"The scheduler cannot find a node that satisfies the Pod's resource requests and placement constraints.",
 first:"kubectl get pods -n production -o wide",
 output:`NAME                         READY   STATUS    NODE\nreports-6bbf7b9d76-h8t2q     0/1     Pending   <none>`,
 steps:[
  {title:"Read scheduling events",cmd:"kubectl describe pod reports-6bbf7b9d76-h8t2q -n production",out:`Events:\n  Warning  FailedScheduling  default-scheduler\n  0/3 nodes are available: 3 Insufficient memory.\n  preemption: 0/3 nodes are available: no suitable preemption victims found.`},
  {title:"Check allocatable capacity",cmd:"kubectl describe nodes",out:`NAME        ALLOCATABLE MEMORY   MEMORY REQUESTS\nworker-01   6Gi                  5.8Gi (96%)\nworker-02   6Gi                  5.9Gi (98%)\nworker-03   4Gi                  3.9Gi (97%)\n\nPod memory request: 2Gi`},
  {title:"Inspect requests and placement rules",cmd:"kubectl get deployment reports -n production -o yaml",out:`resources:\n  requests:\n    cpu: "1"\n    memory: 2Gi\nnodeSelector:\n  workload: analytics\n# No eligible node has enough unrequested memory.`}
 ],
 cause:"The Pod requests 2Gi of memory, but no eligible node has that much unallocated schedulable memory. Scheduling uses requests and constraints, not simply current observed RAM usage.",
 fix:"Right-size requests based on measured application needs, add node capacity, or correct unintended nodeSelector/affinity/taint constraints. Avoid blindly lowering requests in production.",
 verify:"kubectl get pods -n production -o wide\nkubectl describe pod reports-6bbf7b9d76-h8t2q -n production",
 lesson:"For Pending Pods, inspect FailedScheduling events first. Then evaluate requests, allocatable capacity, affinity, selectors, taints/tolerations and PVC binding."
},
{
 id:"oom",title:"OOMKilled container",category:"Scheduling & Resources",severity:"High",level:"Intermediate",symptom:"Container is terminated after exhausting its memory limit.",tags:["memory","exit-137","limits"],
 summary:"A container exceeded its memory cgroup limit or was killed during memory pressure.",
 first:"kubectl describe pod worker-5f8d6c9d9c-r7x2n -n production",
 output:`Last State:     Terminated\nReason:         OOMKilled\nExit Code:      137\nRestart Count:  4`,
 steps:[
  {title:"Confirm the termination reason",cmd:"kubectl describe pod worker-5f8d6c9d9c-r7x2n -n production",out:`Last State: Terminated\nReason: OOMKilled\nExit Code: 137\nLast termination: 2026-10-16T08:55:03Z`},
  {title:"Inspect current usage",cmd:"kubectl top pod worker-5f8d6c9d9c-r7x2n -n production --containers",out:`POD                         NAME    CPU(cores)   MEMORY(bytes)\nworker-5f8d6c9d9c-r7x2n     worker  420m         980Mi\n\nConfigured memory limit: 1Gi (simulated)`},
  {title:"Review workload limits and history",cmd:"kubectl get deployment worker -n production -o yaml",out:`resources:\n  requests:\n    memory: 512Mi\n  limits:\n    memory: 1Gi\n\nReview application heap, concurrency, batch size and recent traffic changes.`}
 ],
 cause:"The recorded termination reason confirms an OOM kill. Memory usage is near the 1Gi limit. Exit code 137 alone is not proof of OOMKilled; the termination reason and events matter.",
 fix:"Profile memory use and leaks, tune application heap/concurrency/batch size, and set requests/limits based on measured peaks. Raise limits only after checking node capacity and workload behavior.",
 verify:"kubectl describe pod <pod> -n production\nkubectl top pod -n production --containers\nkubectl get events -n production --sort-by=.lastTimestamp",
 lesson:"Metrics collected after a restart may miss the peak. Combine termination state, events, historical monitoring and application-level memory metrics."
},
{
 id:"imagepull",title:"ImagePullBackOff",category:"Images & Releases",severity:"High",level:"Beginner",symptom:"Kubelet cannot pull the requested container image.",tags:["registry","image","credentials"],
 summary:"The image reference, registry access, tag, or pull credentials are invalid.",
 first:"kubectl describe pod checkout-68c8cdbb7d-x5m9v -n production",
 output:`Warning  Failed     kubelet  Failed to pull image\nregistry.example.com/shop/checkout:v2.8.4\nmanifest unknown\nWarning  BackOff    kubelet  Back-off pulling image`,
 steps:[
  {title:"Inspect the exact pull error",cmd:"kubectl describe pod checkout-68c8cdbb7d-x5m9v -n production",out:`Failed to pull image "registry.example.com/shop/checkout:v2.8.4":\nmanifest unknown`},
  {title:"Check the deployed image reference",cmd:"kubectl get deployment checkout -n production -o jsonpath='{.spec.template.spec.containers[*].image}'",out:`registry.example.com/shop/checkout:v2.8.4\n\nCompare the exact tag and repository with the CI build and registry manifest.`},
  {title:"Check pull-secret wiring",cmd:"kubectl get serviceaccount default -n production -o yaml",out:`imagePullSecrets:\n- name: registry-credentials\n\nConfirm the Secret exists in the same namespace and contains valid registry credentials. Never print secret data into logs.`}
 ],
 cause:"The registry responds that tag v2.8.4 does not exist. A typo, failed push, wrong repository, expired credentials, TLS trust or network access can produce related image-pull failures.",
 fix:"Publish the expected immutable image tag or update the Deployment to a verified tag. If the error is authentication, repair imagePullSecrets/service-account wiring. Check registry DNS, TLS and network policies for connectivity errors.",
 verify:"kubectl rollout status deployment/checkout -n production\nkubectl get pods -n production\nkubectl describe pod <pod> -n production",
 lesson:"Read the precise pull error. 'manifest unknown', 'unauthorized', DNS failures and TLS errors point to different fixes."
},
{
 id:"probes",title:"Liveness/readiness probe failures",category:"Pods & Containers",severity:"Medium",level:"Intermediate",symptom:"Pod restarts or never becomes Ready.",tags:["probe","health","startup"],
 summary:"Probe settings do not match application startup time, endpoint, port or health behavior.",
 first:"kubectl describe pod payments-7d88b6f6f7-9c2kd -n production",
 output:`Warning  Unhealthy  kubelet  Readiness probe failed: HTTP probe failed with statuscode: 503\nWarning  Unhealthy  kubelet  Liveness probe failed: connection refused`,
 steps:[
  {title:"Read probe events",cmd:"kubectl describe pod payments-7d88b6f6f7-9c2kd -n production",out:`Readiness: http-get http://:8080/ready delay=5s timeout=1s\nLiveness:  http-get http://:8080/health delay=10s timeout=1s\nReadiness probe failed: HTTP 503`},
  {title:"Check application startup logs",cmd:"kubectl logs payments-7d88b6f6f7-9c2kd -n production --tail=100",out:`Starting application...\nLoading schema migrations...\nDatabase connection pool initializing...\nHealth endpoint returned NOT_READY while initialization continued.`},
  {title:"Review probe configuration",cmd:"kubectl get deployment payments -n production -o yaml",out:`initialDelaySeconds: 10\ntimeoutSeconds: 1\nfailureThreshold: 3\n\nStartup normally takes 45 seconds in this scenario.`}
 ],
 cause:"The application needs around 45 seconds to initialize, but the liveness probe begins too early and has a short timeout. Repeated liveness failures restart it before startup finishes.",
 fix:"Add a startupProbe with an appropriate failure threshold and period. Tune readiness to reflect when the app can serve traffic; use liveness only to detect a genuinely stuck process. Confirm endpoint and port.",
 verify:"kubectl rollout status deployment/payments -n production\nkubectl describe pod <pod> -n production",
 lesson:"Readiness removes a Pod from Service endpoints; liveness can restart a container; startup probes protect slow-starting apps from premature liveness checks."
},
{
 id:"config",title:"ConfigMap/Secret missing",category:"Configuration & Access",severity:"High",level:"Beginner",symptom:"Container cannot start because a required configuration object or key is absent.",tags:["secret","configmap","environment"],
 summary:"The workload references a nonexistent ConfigMap/Secret or an incorrect key.",
 first:"kubectl describe pod catalog-6bdf9f9d5c-mp8ql -n production",
 output:`Warning  Failed  kubelet  Error: configmap "catalog-settings" not found`,
 steps:[
  {title:"Inspect Pod events",cmd:"kubectl describe pod catalog-6bdf9f9d5c-mp8ql -n production",out:`MountVolume.SetUp failed for volume "settings": configmap "catalog-settings" not found`},
  {title:"List configuration objects",cmd:"kubectl get configmaps,secrets -n production",out:`NAME                         DATA\nconfigmap/catalog-config      4\nsecret/catalog-db             3\n\nExpected configmap/catalog-settings is absent.`},
  {title:"Inspect workload references",cmd:"kubectl get deployment catalog -n production -o yaml",out:`volumes:\n- name: settings\n  configMap:\n    name: catalog-settings\n\nDeployment references a name that differs from the existing catalog-config.`}
 ],
 cause:"The Deployment references catalog-settings, while the available ConfigMap is catalog-config. Kubernetes cannot mount the missing object.",
 fix:"Correct the reference or create the intended ConfigMap using a controlled configuration workflow. Validate required keys and namespace. Handle Secrets securely; never paste secret values into shared logs.",
 verify:"kubectl get configmap catalog-config -n production\nkubectl describe pod <pod> -n production\nkubectl rollout status deployment/catalog -n production",
 lesson:"ConfigMaps and Secrets are namespace-scoped. Check exact object names, key names, volume/env references and deployment version."
},
{
 id:"dns",title:"CoreDNS / DNS resolution failure",category:"Networking & DNS",severity:"High",level:"Intermediate",symptom:"Pods cannot resolve service or external hostnames.",tags:["dns","coredns","network"],
 summary:"DNS queries time out or return NXDOMAIN from inside a Pod.",
 first:"kubectl exec -n production deploy/api -- nslookup postgres.data.svc.cluster.local",
 output:`;; connection timed out; no servers could be reached\n\nPod DNS server: 10.96.0.10`,
 steps:[
  {title:"Test DNS from an affected Pod",cmd:"kubectl exec -n production deploy/api -- nslookup postgres.data.svc.cluster.local",out:`;; connection timed out; no servers could be reached\nDNS server configured: 10.96.0.10`},
  {title:"Check CoreDNS health",cmd:"kubectl get pods -n kube-system -l k8s-app=kube-dns",out:`NAME                       READY   STATUS    RESTARTS\ncoredns-6f6b679f8f-2k9qz   1/1     Running   0\ncoredns-6f6b679f8f-r4n2c   1/1     Running   0\n\nPods appear Ready; check logs and service endpoints next.`},
  {title:"Inspect DNS service and endpoints",cmd:"kubectl get svc,endpoints -n kube-system kube-dns",out:`NAME                 TYPE        CLUSTER-IP\nservice/kube-dns     ClusterIP   10.96.0.10\n\nENDPOINTS: 10.244.1.20:53,10.244.2.21:53\n\nInvestigate CNI, NetworkPolicy, node firewall and packet path.`}
 ],
 cause:"CoreDNS Pods and endpoints look healthy, but queries time out. The scenario points toward a network path issue between the affected workload and DNS endpoints, such as CNI or NetworkPolicy behavior.",
 fix:"Compare DNS from affected and healthy Pods/nodes, inspect CoreDNS logs, kube-dns endpoints, NetworkPolicies, CNI health and node firewall rules. Make only a scoped, policy-compliant correction.",
 verify:"kubectl get pods -n kube-system -l k8s-app=kube-dns\nkubectl get svc,endpoints -n kube-system kube-dns\nkubectl exec -n production deploy/api -- nslookup kubernetes.default",
 lesson:"NXDOMAIN often means a name/namespace is wrong; timeout suggests reachability or DNS health; SERVFAIL suggests resolver/upstream issues. Confirm the exact error."
},
{
 id:"service",title:"Service has no endpoints",category:"Networking & DNS",severity:"High",level:"Beginner",symptom:"Service exists, but requests fail because no Pods are selected.",tags:["service","selector","endpoints"],
 summary:"Service selectors do not match Pod labels, or selected Pods are not Ready.",
 first:"kubectl get endpoints checkout -n production",
 output:`NAME       ENDPOINTS   AGE\ncheckout   <none>      4d`,
 steps:[
  {title:"Inspect Service selector",cmd:"kubectl describe service checkout -n production",out:`Selector: app=checkout-api\nPort: 80/TCP\nTargetPort: 8080/TCP\nEndpoints: <none>`},
  {title:"Inspect Pod labels and readiness",cmd:"kubectl get pods -n production --show-labels",out:`NAME                        READY   LABELS\ncheckout-7b8d9f6f54-k4p2x   1/1     app=checkout\ncheckout-7b8d9f6f54-q9w6v   1/1     app=checkout`},
  {title:"Compare selector and labels",cmd:"kubectl get service checkout -n production -o yaml",out:`spec:\n  selector:\n    app: checkout-api\n\nPods use app=checkout. Selector does not match.`}
 ],
 cause:"The Service selects app=checkout-api, while the actual Pods are labelled app=checkout. No endpoints are created for the Service.",
 fix:"Align the Service selector and workload labels using the intended label convention. Verify ports, targetPort and readiness after applying the change.",
 verify:"kubectl get endpoints checkout -n production\nkubectl get pods -n production --show-labels\nkubectl describe service checkout -n production",
 lesson:"Check Service selectors, EndpointSlices, Pod readiness, targetPort and network policy before assuming the application itself is down."
},
{
 id:"ingress",title:"Ingress returns 404/502",category:"Networking & DNS",severity:"Medium",level:"Intermediate",symptom:"External HTTP traffic reaches the ingress but does not reach the app correctly.",tags:["ingress","gateway","tls"],
 summary:"Host/path rules, ingress class, backend Service, endpoints or TLS configuration are incorrect.",
 first:"kubectl describe ingress storefront -n production",
 output:`Host: shop.example.com\nPath: /\nBackend: storefront:80\nAddress: 203.0.113.20\n\nClient sees HTTP 502 Bad Gateway`,
 steps:[
  {title:"Inspect ingress rules and events",cmd:"kubectl describe ingress storefront -n production",out:`Rules:\n  Host: shop.example.com\n  /  storefront:80 (<error: service port not found>)\nEvents: no matching backend port`},
  {title:"Inspect backend Service ports",cmd:"kubectl get service storefront -n production -o yaml",out:`ports:\n- name: web\n  port: 8080\n  targetPort: 3000\n\nIngress points to Service port 80, which does not exist.`},
  {title:"Check controller and endpoints",cmd:"kubectl get pods,svc,endpoints -n production",out:`Service storefront exposes port 8080 -> targetPort 3000.\nEndpoints are present.\nIngress backend references port 80.`}
 ],
 cause:"The Ingress backend references Service port 80, but the Service exposes port 8080. The controller cannot route to the specified backend port.",
 fix:"Update the Ingress backend to reference the actual Service port (by name or number), then verify ingressClass, host/path rules, controller logs, endpoints and TLS configuration.",
 verify:"kubectl describe ingress storefront -n production\nkubectl get svc,endpoints storefront -n production\nkubectl get events -n production --sort-by=.lastTimestamp",
 lesson:"A 404 often indicates host/path or rule mismatch; 502/503 often indicates backend/endpoint/connectivity problems. Inspect controller logs for confirmation."
},
{
 id:"networkpolicy",title:"NetworkPolicy blocks traffic",category:"Networking & DNS",severity:"High",level:"Advanced",symptom:"Pods are healthy but cannot connect to a peer service.",tags:["networkpolicy","egress","ingress"],
 summary:"A default-deny or overly narrow NetworkPolicy blocks required ingress or egress.",
 first:"kubectl exec -n production deploy/api -- nc -vz postgres.data.svc.cluster.local 5432",
 output:`nc: connect to postgres.data.svc.cluster.local port 5432 timed out\n\nDNS resolution succeeds. TCP connection does not.`,
 steps:[
  {title:"Confirm scope of the failure",cmd:"kubectl exec -n production deploy/api -- nc -vz postgres.data.svc.cluster.local 5432",out:`Name resolves to 10.96.42.18\nTCP connection to port 5432 timed out`},
  {title:"List policies in both namespaces",cmd:"kubectl get networkpolicy -A",out:`NAMESPACE    NAME                 POD-SELECTOR\nproduction   default-deny-egress  <all pods>\ndata         allow-from-api       app=postgres\n\nProduction namespace has a default-deny egress policy.`},
  {title:"Inspect allowed peers and ports",cmd:"kubectl describe networkpolicy default-deny-egress -n production",out:`Policy Types: Egress\nEgress: <none>\n\nNo egress exception permits traffic to the data namespace on TCP/5432.`}
 ],
 cause:"The production namespace's default-deny egress policy blocks the API's database connection. DNS works, but TCP traffic is not allowed.",
 fix:"Add a narrowly scoped egress rule for the intended database Pod labels and TCP port 5432, plus any required DNS egress. Ensure the CNI enforces NetworkPolicy and validate both sides.",
 verify:"kubectl get networkpolicy -A\nkubectl exec -n production deploy/api -- nc -vz postgres.data.svc.cluster.local 5432",
 lesson:"NetworkPolicies are additive allow rules. Verify namespace selectors, Pod selectors, direction, ports, DNS allowance and CNI support."
},
{
 id:"pvc",title:"PVC stuck Pending",category:"Storage",severity:"High",level:"Intermediate",symptom:"PersistentVolumeClaim cannot bind to storage.",tags:["pvc","storageclass","volume"],
 summary:"No compatible PV can be bound or dynamic provisioning is failing.",
 first:"kubectl describe pvc data-postgres-0 -n data",
 output:`Name:          data-postgres-0\nStatus:        Pending\nStorageClass:  fast-ssd\nCapacity:      <none>\nEvents: waiting for a volume to be created`,
 steps:[
  {title:"Inspect PVC events",cmd:"kubectl describe pvc data-postgres-0 -n data",out:`Warning ProvisioningFailed\nstorageclass.storage.k8s.io "fast-ssd" not found`},
  {title:"List StorageClasses",cmd:"kubectl get storageclass",out:`NAME                 PROVISIONER\nstandard (default)   csi.example.io\n\nNo StorageClass named fast-ssd exists.`},
  {title:"Review PVC request",cmd:"kubectl get pvc data-postgres-0 -n data -o yaml",out:`spec:\n  storageClassName: fast-ssd\n  accessModes: [ReadWriteOnce]\n  resources:\n    requests:\n      storage: 100Gi`}
 ],
 cause:"The PVC explicitly requests a nonexistent StorageClass named fast-ssd, so dynamic provisioning cannot begin.",
 fix:"Use a supported StorageClass or provision the intended class through the platform's storage process. Confirm capacity, access mode, topology and CSI driver requirements before changing a production claim.",
 verify:"kubectl get pvc -n data\nkubectl describe pvc data-postgres-0 -n data\nkubectl get storageclass",
 lesson:"PVC Pending can result from missing StorageClasses, capacity, access-mode mismatch, topology constraints, CSI issues or delayed binding. Events usually narrow it down."
},
{
 id:"mount",title:"FailedMount / volume attach error",category:"Storage",severity:"High",level:"Advanced",symptom:"Pod cannot mount or attach its volume.",tags:["volume","csi","mount"],
 summary:"The volume controller or node plugin cannot attach, stage or mount the requested volume.",
 first:"kubectl describe pod postgres-0 -n data",
 output:`Warning FailedMount kubelet\nMountVolume.MountDevice failed for volume "data"\nvolume attachment is being deleted`,
 steps:[
  {title:"Inspect Pod mount events",cmd:"kubectl describe pod postgres-0 -n data",out:`Warning FailedMount\nMountVolume.MountDevice failed: volume attachment is being deleted`},
  {title:"Inspect PVC, PV and attachments",cmd:"kubectl get pvc,pv -n data\nkubectl get volumeattachment",out:`PVC data-postgres-0: Bound\nPV pv-8a71: Bound\nVolumeAttachment: attached to worker-02; detach pending`},
  {title:"Check CSI components and node health",cmd:"kubectl get pods -A | grep -i csi",out:`csi-controller-0    2/2 Running\ncsi-node-worker-01   2/2 Running\ncsi-node-worker-02   1/2 CrashLoopBackOff\n\nNode plugin on target worker is unhealthy in this simulation.`}
 ],
 cause:"The CSI node plugin on worker-02 is unhealthy while a volume attachment operation is pending.",
 fix:"Check the storage provider, CSI controller/node logs, target node health and attachment state. Follow the storage vendor's recovery procedure; do not force-delete attachments or PVs without confirming data safety.",
 verify:"kubectl describe pod postgres-0 -n data\nkubectl get pvc,pv -n data\nkubectl get volumeattachment",
 lesson:"Storage recovery is stateful and can risk data loss. Confirm which node owns the volume and follow the CSI/provider's supported detach/reattach procedure."
},
{
 id:"node",title:"Node NotReady",category:"Nodes & Cluster",severity:"Critical",level:"Intermediate",symptom:"Control plane marks a worker as unhealthy.",tags:["kubelet","containerd","node"],
 summary:"The kubelet is not reporting healthy status, or node heartbeats have stopped.",
 first:"kubectl get nodes -o wide",
 output:`NAME        STATUS     ROLES    AGE   VERSION\nworker-01   Ready      worker   32d   v1.30.4\nworker-02   NotReady   worker   32d   v1.30.4\nworker-03   Ready      worker   32d   v1.30.4`,
 steps:[
  {title:"Inspect node conditions and events",cmd:"kubectl describe node worker-02",out:`Conditions:\n  Ready False KubeletNotReady\n  Message: container runtime is down\n\nLast heartbeat: 6m ago`},
  {title:"Check node service health",cmd:"sudo systemctl status kubelet\nsudo systemctl status containerd",out:`containerd.service: failed\nkubelet.service: active (running)\n\ncontainerd failed after a disk-space incident (simulated).`},
  {title:"Check disk and runtime logs",cmd:"df -h\nsudo journalctl -u containerd --since '30 min ago'",out:`/var/lib/containerd filesystem: 100% used\ncontainerd: failed to write metadata: no space left on device`}
 ],
 cause:"The node filesystem used by containerd is full. The container runtime fails, causing kubelet to report NotReady.",
 fix:"Follow node incident procedures: assess workload redundancy, safely reclaim known-unused data using supported tools, expand/repair storage if needed, restore containerd and kubelet health, then verify node and workloads. Avoid deleting arbitrary containerd files.",
 verify:"kubectl get nodes -o wide\nkubectl describe node worker-02\nkubectl get pods -A -o wide",
 lesson:"NotReady is a status, not a diagnosis. Inspect node conditions, heartbeat, kubelet/runtime, disk, memory, network and provider health."
},
{
 id:"diskpressure",title:"DiskPressure / ephemeral storage",category:"Nodes & Cluster",severity:"Critical",level:"Intermediate",symptom:"Node evicts Pods because local disk or ephemeral storage is low.",tags:["disk","eviction","ephemeral-storage"],
 summary:"Kubelet's disk-pressure eviction thresholds are reached or a workload exceeds ephemeral-storage limits.",
 first:"kubectl describe node worker-03",
 output:`Conditions:\n  DiskPressure True\nEvents:\n  Warning EvictionThresholdMet\n  Attempting to reclaim ephemeral-storage`,
 steps:[
  {title:"Confirm node condition and events",cmd:"kubectl describe node worker-03",out:`DiskPressure: True\nImageFS available: 2%\nNode ephemeral-storage available below eviction threshold`},
  {title:"Identify heavy ephemeral-storage workloads",cmd:"kubectl get pods -A -o wide",out:`logging/fluent-bit-8j9c2   Running\napi/api-7d9c8f6b5d-k2m4p   Running\n\nInspect logs, writable layers, emptyDir use and image storage on the node.`},
  {title:"Check node filesystem",cmd:"df -h\nsudo du -xhd1 /var/lib /var/log 2>/dev/null",out:`/var/lib/containerd  96% used\n/var/log              92% used\n\nSimulated cause: runaway application logs and cached images.`}
 ],
 cause:"Node image/container storage and logs have consumed available disk, triggering DiskPressure and eviction behavior.",
 fix:"Find the actual disk consumers, fix log rotation or runaway writes, clean up unused images through supported runtime tools, and increase node storage if necessary. Configure ephemeral-storage requests/limits for appropriate workloads.",
 verify:"kubectl describe node worker-03\nkubectl get events -A --sort-by=.lastTimestamp\ndf -h",
 lesson:"Do not manually delete files under containerd's internal directories. Establish which filesystem is pressured and reclaim data through safe, supported methods."
},
{
 id:"rbac",title:"Forbidden / RBAC denial",category:"Configuration & Access",severity:"Medium",level:"Beginner",symptom:"A user or service account receives 'forbidden'.",tags:["rbac","serviceaccount","permissions"],
 summary:"The active identity does not have the required verb/resource/scope permission.",
 first:"kubectl get secrets -n production",
 output:`Error from server (Forbidden): secrets is forbidden:\nUser "system:serviceaccount:production:reporter" cannot list resource "secrets" in API group "" in namespace "production"`,
 steps:[
  {title:"Confirm the identity and permission",cmd:"kubectl auth can-i list secrets -n production",out:`no`},
  {title:"Inspect role bindings",cmd:"kubectl get role,rolebinding -n production",out:`NAME                        ROLE\nrole/report-reader          get,list pods\nrolebinding/reporter-view   reporter -> report-reader\n\nThe Role does not grant access to Secrets.`},
  {title:"Check the minimum required access",cmd:"kubectl describe role report-reader -n production",out:`Resources: pods\nVerbs: get, list, watch\n\nNo Secret permissions are defined. The application should not need Secret access for this task.`}
 ],
 cause:"The service account lacks permission to list Secrets. The denial is expected RBAC behavior.",
 fix:"Grant only the minimum required verbs and resources at the narrowest scope, if access is truly necessary. Prefer redesigning the task to avoid Secret access; never grant cluster-admin as a shortcut.",
 verify:"kubectl auth can-i list pods -n production --as=system:serviceaccount:production:reporter\nkubectl auth can-i list secrets -n production --as=system:serviceaccount:production:reporter",
 lesson:"RBAC decisions depend on identity, verb, API group, resource, namespace and binding. Use auth can-i to test intended permissions."
},
{
 id:"serviceaccount",title:"ServiceAccount / token auth failure",category:"Configuration & Access",severity:"Medium",level:"Intermediate",symptom:"An in-cluster workload cannot authenticate to the Kubernetes API.",tags:["serviceaccount","token","authentication"],
 summary:"The Pod references the wrong service account, or its API access/token configuration is unsuitable.",
 first:"kubectl logs controller-7d9b6d9d7b-k2t5x -n production",
 output:`ERROR: Kubernetes API request failed\nGET /apis/apps/v1/deployments\nHTTP 401 Unauthorized`,
 steps:[
  {title:"Check Pod's service account",cmd:"kubectl get pod controller-7d9b6d9d7b-k2t5x -n production -o jsonpath='{.spec.serviceAccountName}'",out:`controller-reader`},
  {title:"Inspect the service account and projected token setup",cmd:"kubectl describe serviceaccount controller-reader -n production",out:`Name: controller-reader\nAutomountServiceAccountToken: false\n\nThe application expects in-cluster API credentials but token automount is disabled.`},
  {title:"Validate API access design",cmd:"kubectl auth can-i list deployments -n production --as=system:serviceaccount:production:controller-reader",out:`yes\n\nRBAC is sufficient; the simulated issue is credential availability, not authorization.`}
 ],
 cause:"The Pod has no usable projected service-account token because automount is disabled and the workload has no explicit token projection.",
 fix:"If API access is required, configure a supported, narrowly scoped projected service-account token and audience/expiry as appropriate. Keep RBAC least-privileged; avoid long-lived manually created tokens.",
 verify:"kubectl describe pod controller-7d9b6d9d7b-k2t5x -n production\nkubectl auth can-i list deployments -n production --as=system:serviceaccount:production:controller-reader",
 lesson:"401 usually indicates authentication/credentials; 403 Forbidden usually indicates authorization/RBAC. Verify the identity and token path before changing Roles."
},
{
 id:"hpa",title:"HPA shows unknown metrics",category:"Autoscaling & Workloads",severity:"Medium",level:"Intermediate",symptom:"HorizontalPodAutoscaler cannot calculate desired replicas.",tags:["hpa","metrics-server","autoscaling"],
 summary:"Resource metrics are missing, or CPU requests required for utilization calculations are not configured.",
 first:"kubectl get hpa -n production",
 output:`NAME   REFERENCE        TARGETS          MINPODS   MAXPODS   REPLICAS\napi    Deployment/api   <unknown>/70%    2         10        2`,
 steps:[
  {title:"Inspect HPA conditions",cmd:"kubectl describe hpa api -n production",out:`Conditions:\n  AbleToScale True\n  ScalingActive False\n  Reason: FailedGetResourceMetric\n  unable to get metrics for resource cpu`},
  {title:"Check metrics API",cmd:"kubectl top pods -n production",out:`error: Metrics API not available`},
  {title:"Check CPU requests",cmd:"kubectl get deployment api -n production -o yaml",out:`containers:\n- name: api\n  resources:\n    limits:\n      cpu: "1"\n    # requests.cpu is missing`}
 ],
 cause:"The metrics API is unavailable in the scenario and the Deployment also lacks CPU requests, which are needed for CPU utilization percentage calculations.",
 fix:"Restore a compatible metrics pipeline (commonly metrics-server for basic resource metrics) and configure realistic CPU requests. Validate HPA metrics, permissions, API aggregation and network reachability.",
 verify:"kubectl get apiservice v1beta1.metrics.k8s.io\nkubectl top nodes\nkubectl describe hpa api -n production",
 lesson:"HPA needs valid metrics and appropriate resource requests for utilization-based scaling. Check HPA conditions and metrics API rather than changing replica counts blindly."
},
{
 id:"rollout",title:"Deployment rollout stuck",category:"Autoscaling & Workloads",severity:"High",level:"Intermediate",symptom:"A rollout never completes and old/new ReplicaSets coexist.",tags:["deployment","rollout","replicaset"],
 summary:"New Pods are not becoming Available, or rollout progress is blocked by readiness, capacity or strategy constraints.",
 first:"kubectl rollout status deployment/api -n production",
 output:`Waiting for deployment "api" rollout to finish: 1 of 4 updated replicas are available...`,
 steps:[
  {title:"Inspect rollout history and status",cmd:"kubectl rollout status deployment/api -n production",out:`Waiting for deployment "api" rollout to finish: 1 of 4 updated replicas are available...`},
  {title:"Inspect ReplicaSets and Pods",cmd:"kubectl get rs,pods -n production -l app=api",out:`NAME                    DESIRED   CURRENT   READY\nrs/api-6d8b7c9f         4         4         1\nrs/api-7b9c8d6f         0         0         0\n\nNew ReplicaSet Pods fail readiness.`},
  {title:"Inspect deployment events and new Pod logs",cmd:"kubectl describe deployment api -n production",out:`Conditions:\n  Progressing=True (ReplicaSetUpdated)\n  Available=False (MinimumReplicasUnavailable)\nEvents: new Pods fail readiness probe with HTTP 503.`}
 ],
 cause:"The new application revision starts but never becomes Ready because its readiness endpoint returns 503. The rollout waits for availability.",
 fix:"Inspect new Pod logs and readiness endpoint behavior. Correct the application/configuration or probe, then monitor rollout status. If impact is ongoing, consider a controlled rollback after reviewing change history and data compatibility.",
 verify:"kubectl rollout status deployment/api -n production\nkubectl rollout history deployment/api -n production\nkubectl get rs,pods -n production -l app=api",
 lesson:"A stalled rollout is often a downstream symptom. Inspect rollout conditions, ReplicaSets, Pod events, probes, scheduling and image pulls before choosing rollback or retry."
},
{
 id:"stateful",title:"StatefulSet replicas not ready",category:"Autoscaling & Workloads",severity:"High",level:"Advanced",symptom:"Ordered stateful replicas fail to start or remain unready.",tags:["statefulset","identity","storage"],
 summary:"A StatefulSet Pod cannot become Ready due to PVC, peer discovery, startup ordering or application quorum issues.",
 first:"kubectl get statefulset kafka -n data",
 output:`NAME    READY   AGE\nkafka   2/3     21d\n\nkafka-2 is Pending; PVC data-kafka-2 is Pending.`,
 steps:[
  {title:"Inspect StatefulSet Pods",cmd:"kubectl get pods -n data -l app=kafka -o wide",out:`kafka-0   1/1 Running\nkafka-1   1/1 Running\nkafka-2   0/1 Pending`},
  {title:"Inspect claim for the missing replica",cmd:"kubectl describe pvc data-kafka-2 -n data",out:`Status: Pending\nWarning: no persistent volumes available for this claim and no storage class is set.`},
  {title:"Review StatefulSet claim template",cmd:"kubectl get statefulset kafka -n data -o yaml",out:`volumeClaimTemplates:\n- metadata:\n    name: data\n  spec:\n    storageClassName: ""\n    resources:\n      requests:\n        storage: 100Gi`}
 ],
 cause:"The StatefulSet's claim template disables dynamic provisioning by setting an empty storageClassName, and no matching pre-provisioned volume is available for kafka-2.",
 fix:"Follow the storage and database operator's process to provide a compatible volume or correct the claim template for future claims. Stateful storage changes need a data safety and recovery plan; do not delete PVCs casually.",
 verify:"kubectl get statefulset,pods,pvc -n data\nkubectl describe pod kafka-2 -n data",
 lesson:"StatefulSets preserve stable identity and storage. Diagnose the specific replica, claim, headless Service, peer/quorum state and ordered rollout behavior."
},
{
 id:"job",title:"Job / CronJob fails",category:"Autoscaling & Workloads",severity:"Medium",level:"Beginner",symptom:"Batch workload exits unsuccessfully or does not start on schedule.",tags:["job","cronjob","batch"],
 summary:"The Job's container fails, the schedule is suspended/misconfigured, or concurrency and deadline settings prevent completion.",
 first:"kubectl get jobs,cronjobs -n batch",
 output:`NAME                   COMPLETIONS   DURATION   AGE\nnightly-report-29101   0/1           0s         8m\n\nJob has failed Pods.`,
 steps:[
  {title:"Inspect Job status and events",cmd:"kubectl describe job nightly-report-29101 -n batch",out:`Failed: 1\nBackoffLimitExceeded\nThe pod has failed repeatedly.`},
  {title:"Read failed Pod logs",cmd:"kubectl logs job/nightly-report-29101 -n batch",out:`Starting nightly report...\nERROR: cannot connect to database at postgres.data.svc:5432\nExit code 1`},
  {title:"Check CronJob schedule and history",cmd:"kubectl describe cronjob nightly-report -n batch",out:`Schedule: 0 2 * * *\nSuspend: False\nConcurrency Policy: Forbid\nLast Schedule Time: 2026-10-16T02:00:00Z\n\nJob started; application dependency failed.`}
 ],
 cause:"The Job started on schedule but the application could not connect to its database and exhausted its retry limit.",
 fix:"Investigate database availability, DNS, network policy, credentials and retry behavior. Once the dependency is healthy, rerun using the team's approved process and ensure the task is idempotent.",
 verify:"kubectl get jobs,cronjobs -n batch\nkubectl logs job/<job-name> -n batch\nkubectl describe job <job-name> -n batch",
 lesson:"Separate scheduling failure from application failure. Inspect Job conditions, failed Pod logs, backoffLimit, activeDeadlineSeconds and CronJob concurrency."
},
{
 id:"pdb",title:"Eviction blocked by PodDisruptionBudget",category:"Scheduling & Resources",severity:"Medium",level:"Advanced",symptom:"A voluntary drain cannot evict a Pod.",tags:["pdb","drain","availability"],
 summary:"A disruption budget prevents voluntary disruption because too few replicas are currently healthy.",
 first:"kubectl drain worker-02 --ignore-daemonsets",
 output:`error when evicting pods/"api-7d9c8f6b5d-k2m4p":\nCannot evict pod as it would violate the pod's disruption budget.`,
 steps:[
  {title:"Inspect the PodDisruptionBudget",cmd:"kubectl get pdb -n production",out:`NAME       MIN AVAILABLE   ALLOWED DISRUPTIONS   AGE\napi-pdb    3               0                     14d`},
  {title:"Check actual healthy replicas",cmd:"kubectl get deployment api -n production",out:`NAME   READY   UP-TO-DATE   AVAILABLE\na pi   3/4     4            3\n\nBudget requires 3 healthy replicas; no voluntary disruption is currently allowed.`},
  {title:"Inspect unhealthy replicas",cmd:"kubectl get pods -n production -l app=api",out:`api-1  1/1 Running\napi-2  1/1 Running\napi-3  1/1 Running\napi-4  0/1 CrashLoopBackOff`}
 ],
 cause:"The PDB requires three healthy replicas and only three are currently available, so evicting another would violate the budget.",
 fix:"Restore the unhealthy replica or plan a maintenance window with sufficient capacity. Adjust a PDB only after understanding availability risk and getting the appropriate approval; do not bypass eviction safeguards casually.",
 verify:"kubectl get pdb -n production\nkubectl get deployment api -n production\nkubectl get pods -n production -l app=api",
 lesson:"PDBs constrain voluntary disruptions, not all failures. Check healthy replica count, selectors, minAvailable/maxUnavailable and cluster capacity before draining."
},
{
 id:"cert",title:"TLS certificate / HTTPS failure",category:"Networking & DNS",severity:"Medium",level:"Intermediate",symptom:"Clients see an expired, untrusted or hostname-mismatched certificate.",tags:["tls","certificate","ingress"],
 summary:"The TLS Secret, certificate chain, hostname or certificate renewal is incorrect.",
 first:"kubectl describe ingress storefront -n production",
 output:`TLS:\n  shop.example.com terminates at storefront-tls\n\nClient error: certificate has expired`,
 steps:[
  {title:"Inspect ingress TLS reference",cmd:"kubectl describe ingress storefront -n production",out:`TLS Secret: storefront-tls\nHost: shop.example.com\nIngress controller reports certificate expiry.`},
  {title:"Check certificate metadata safely",cmd:"kubectl get secret storefront-tls -n production -o jsonpath='{.type}'",out:`kubernetes.io/tls\n\nInspect certificate expiry/subject with approved tooling. Do not print or expose private keys.`},
  {title:"Check certificate automation",cmd:"kubectl get certificate,certificaterequest -n production",out:`NAME              READY   SECRET\nstorefront-cert    False   storefront-tls\n\nCondition: renewal failed; issuer challenge pending.`}
 ],
 cause:"The certificate renewal failed, leaving the TLS Secret with an expired certificate.",
 fix:"Inspect cert-manager events, issuer status, DNS/HTTP challenge reachability and certificate request details. Restore the renewal path and verify the issued certificate's SAN, chain and expiry before rollout.",
 verify:"kubectl describe certificate storefront-cert -n production\nkubectl describe ingress storefront -n production",
 lesson:"Distinguish certificate expiry, hostname mismatch, missing Secret, incomplete chain and TLS protocol errors. Protect private keys and validate the served certificate."
},
{
 id:"webhook",title:"Admission webhook timeout/denial",category:"Security & Policy",severity:"High",level:"Advanced",symptom:"API requests fail during admission before objects are created or updated.",tags:["webhook","admission","policy"],
 summary:"A validating/mutating webhook is unavailable, times out, or rejects a resource under policy.",
 first:"kubectl apply -f deployment.yaml",
 output:`Error from server (InternalError):\nfailed calling webhook "validate.example.io":\ncontext deadline exceeded`,
 steps:[
  {title:"Inspect API error and recent events",cmd:"kubectl get events -A --sort-by=.lastTimestamp",out:`Warning FailedCreate deployment/api\nfailed calling webhook "validate.example.io": context deadline exceeded`},
  {title:"Inspect webhook configuration and service",cmd:"kubectl get validatingwebhookconfigurations\nkubectl get svc,endpoints -n policy-system",out:`Webhook: validate.example.io\nService: policy-webhook\nEndpoints: <none>`},
  {title:"Inspect webhook Pods",cmd:"kubectl get pods -n policy-system",out:`NAME                              READY   STATUS\npolicy-webhook-6f7d8d9c4f-b2m8x   0/1     CrashLoopBackOff\n\nWebhook service has no ready endpoints.`}
 ],
 cause:"The admission webhook backend is unhealthy and has no ready endpoints. API operations requiring the webhook time out.",
 fix:"Restore the webhook deployment, certificate and service endpoints; inspect its logs and dependencies. Changing failurePolicy can weaken enforcement and should be a deliberate, approved emergency decision—not a default fix.",
 verify:"kubectl get pods,svc,endpoints -n policy-system\nkubectl describe validatingwebhookconfiguration <name>",
 lesson:"Admission failures occur before the resource is accepted. Identify the webhook, inspect service/endpoints/certificates and understand fail-open vs fail-closed policy."
},
{
 id:"quota",title:"ResourceQuota / LimitRange rejection",category:"Scheduling & Resources",severity:"Medium",level:"Intermediate",symptom:"Creating or scaling Pods is rejected by namespace policy.",tags:["quota","limitrange","resources"],
 summary:"Namespace quota is exhausted or a resource request/limit violates LimitRange policy.",
 first:"kubectl apply -f deployment.yaml",
 output:`Error from server (Forbidden): exceeded quota:\nproduction-quota, requested: requests.cpu=2,\nused: requests.cpu=18, limited: requests.cpu=20`,
 steps:[
  {title:"Inspect namespace quota usage",cmd:"kubectl describe resourcequota -n production",out:`Resource       Used    Hard\nrequests.cpu   18      20\nlimits.cpu     32      40\npods           48      60\n\nNew Deployment requests 2 CPU.`},
  {title:"Inspect LimitRanges",cmd:"kubectl describe limitrange -n production",out:`Container min CPU: 100m\nContainer max CPU: 2\nDefault request CPU: 250m\n\nRequested CPU is valid for LimitRange but exhausts quota.`},
  {title:"Review workload requests and namespace allocation",cmd:"kubectl get deployment -n production",out:`Multiple workloads reserve CPU requests even when observed usage is lower.\nQuota accounts for declared requests, not current CPU consumption.`}
 ],
 cause:"The namespace's CPU request quota is fully consumed by the requested change. Existing CPU requests count toward quota even if current usage is low.",
 fix:"Review workload requests, remove genuinely obsolete workloads through the approved process, or have the platform owner adjust namespace quota based on capacity. Avoid setting artificially tiny requests just to bypass policy.",
 verify:"kubectl describe resourcequota -n production\nkubectl get deployment -n production",
 lesson:"Quota controls admission; scheduling controls placement. A request can be rejected before a Pod exists, while Pending indicates an admitted Pod cannot be scheduled."
},
{
 id:"api",title:"Kubernetes API server unavailable",category:"Nodes & Cluster",severity:"Critical",level:"Advanced",symptom:"kubectl cannot reach or authenticate to the API endpoint.",tags:["apiserver","kubeconfig","etcd"],
 summary:"The API endpoint is unreachable, TLS/authentication fails, or control-plane components are unhealthy.",
 first:"kubectl cluster-info",
 output:`Unable to connect to the server: dial tcp 10.0.0.10:6443: i/o timeout`,
 steps:[
  {title:"Distinguish connectivity from auth",cmd:"kubectl cluster-info",out:`dial tcp 10.0.0.10:6443: i/o timeout\n\nThe client is not receiving a TCP response from the configured endpoint.`},
  {title:"Verify selected context and endpoint",cmd:"kubectl config current-context\nkubectl config view --minify",out:`Context: production-admin\nServer: https://10.0.0.10:6443\n\nConfirm this is the correct endpoint and that network/VPN access is expected.`},
  {title:"Check control-plane/provider health",cmd:"kubectl get --raw=/readyz",out:`Request timed out before a response.\n\nIf the endpoint is unreachable, use the platform's control-plane and network diagnostics outside kubectl.`}
 ],
 cause:"The configured API endpoint is timing out. This points first to endpoint reachability, network path, load balancer or control-plane health—not a Pod-level issue.",
 fix:"Confirm kubeconfig context, endpoint, VPN/network path, load balancer health and provider/control-plane status. For self-managed clusters, use authorized control-plane host access and documented recovery procedures.",
 verify:"kubectl cluster-info\nkubectl get --raw=/readyz",
 lesson:"A timeout differs from x509 errors, 401 and 403. Check context and connectivity first; avoid changing workloads when the API itself is unreachable."
},
{
 id:"version",title:"API version / deprecated manifest",category:"Security & Policy",severity:"Low",level:"Beginner",symptom:"Manifest is rejected because its API version or schema is unsupported.",tags:["api-version","yaml","upgrade"],
 summary:"The manifest uses an API version removed from the cluster or has invalid fields.",
 first:"kubectl apply --dry-run=server -f deployment.yaml",
 output:`error: resource mapping not found for name: "example" namespace: "production"\nno matches for kind "Ingress" in version "extensions/v1beta1"`,
 steps:[
  {title:"Identify the rejected API version",cmd:"kubectl apply --dry-run=server -f deployment.yaml",out:`Ingress extensions/v1beta1 is not served by this cluster.`},
  {title:"Check supported API resources",cmd:"kubectl api-resources",out:`Ingress   networking.k8s.io/v1   true   Ingress\n\nCluster supports networking.k8s.io/v1.`},
  {title:"Validate the current schema",cmd:"kubectl explain ingress --api-version=networking.k8s.io/v1",out:`Use apiVersion: networking.k8s.io/v1\nRequired fields include spec.rules[].http.paths[].pathType and backend.service.name/port.`}
 ],
 cause:"The manifest uses the removed extensions/v1beta1 Ingress API instead of the supported networking.k8s.io/v1 schema.",
 fix:"Update apiVersion and migrate fields to the current schema. Validate with kubectl explain and server-side dry-run against a compatible non-production cluster before rollout.",
 verify:"kubectl apply --dry-run=server -f deployment.yaml\nkubectl diff -f deployment.yaml",
 lesson:"Kubernetes API versions evolve. Check cluster version, served resources, required schema fields and deprecation notes before upgrading manifests."
},
{
 id:"crd",title:"Custom Resource / CRD not found",category:"Security & Policy",severity:"Medium",level:"Intermediate",symptom:"kubectl cannot create a custom resource kind.",tags:["crd","operator","custom-resource"],
 summary:"The CustomResourceDefinition is not installed/established, or the API group/version/kind is wrong.",
 first:"kubectl apply -f appcluster.yaml",
 output:`error: resource mapping not found for name: "analytics" namespace: "production"\nno matches for kind "AppCluster" in version "apps.example.io/v1alpha1"`,
 steps:[
  {title:"Check whether the CRD exists",cmd:"kubectl get crd appclusters.apps.example.io",out:`Error from server (NotFound): customresourcedefinitions.apiextensions.k8s.io "appclusters.apps.example.io" not found`},
  {title:"Inspect installed APIs",cmd:"kubectl api-resources | grep -i appcluster",out:`No matching API resource found.`},
  {title:"Check operator installation",cmd:"kubectl get pods -A | grep -i operator",out:`No apps.example.io operator found in the simulated cluster.`}
 ],
 cause:"The AppCluster CRD and its operator are not installed, so the API server does not recognize the custom kind.",
 fix:"Install the correct, trusted operator/CRD version using the platform's approved deployment process, wait for the CRD to be Established, and verify compatibility before applying custom resources.",
 verify:"kubectl get crd appclusters.apps.example.io\nkubectl api-resources | grep -i appcluster",
 lesson:"A custom resource depends on its CRD being registered. Operators also need to be running and compatible; installing a CRD alone may not implement its behavior."
},
{
 id:"evicted",title:"Pod Evicted",category:"Nodes & Cluster",severity:"High",level:"Intermediate",symptom:"Kubelet terminates a Pod due to node resource pressure.",tags:["eviction","memory","ephemeral-storage"],
 summary:"Kubelet evicts a Pod when node-level resource pressure crosses configured thresholds.",
 first:"kubectl get pods -n production",
 output:`NAME                     READY   STATUS\nbatch-processor-5d9f7    0/1     Evicted`,
 steps:[
  {title:"Read the eviction message",cmd:"kubectl describe pod batch-processor-5d9f7 -n production",out:`Status: Failed\nReason: Evicted\nMessage: The node was low on resource: ephemeral-storage.`},
  {title:"Inspect node pressure",cmd:"kubectl describe node worker-03",out:`DiskPressure: True\nImageFS.available below eviction threshold`},
  {title:"Inspect Pod storage configuration",cmd:"kubectl get pod batch-processor-5d9f7 -n production -o yaml",out:`containers:\n- name: processor\n  # ephemeral-storage request/limit not set\nvolumeMounts:\n- name: scratch\n  mountPath: /tmp\nvolumes:\n- name: scratch\n  emptyDir: {}`}
 ],
 cause:"The node reached ephemeral-storage pressure, and the workload's scratch/log storage contributed to disk consumption.",
 fix:"Recover node disk headroom, inspect log growth and emptyDir use, set appropriate ephemeral-storage requests/limits, and tune scratch storage. Recreate the failed workload through its controller after the node is healthy.",
 verify:"kubectl describe node worker-03\nkubectl get pods -n production\nkubectl get events -A --sort-by=.lastTimestamp",
 lesson:"Evicted Pods usually point to node pressure or local storage constraints. Fix the node/workload cause before deleting evidence or repeatedly recreating Pods."
},
{
 id:"init",title:"Init container stuck",category:"Pods & Containers",severity:"Medium",level:"Intermediate",symptom:"Main application container never starts because an init container has not completed.",tags:["init-container","dependencies","logs"],
 summary:"An init container is failing or waiting for a dependency before the application container can start.",
 first:"kubectl get pod orders-7c8d9b -n production",
 output:`NAME             READY   STATUS\norders-7c8d9b    0/1     Init:CrashLoopBackOff`,
 steps:[
  {title:"Inspect init container state",cmd:"kubectl describe pod orders-7c8d9b -n production",out:`Init Containers:\n  wait-for-db:\n    State: Waiting\n    Reason: CrashLoopBackOff\nEvents: Back-off restarting failed container wait-for-db`},
  {title:"Read init container logs",cmd:"kubectl logs orders-7c8d9b -n production -c wait-for-db --previous",out:`Checking database readiness...\nnslookup: can't resolve postgres.data.svc.cluster.local`},
  {title:"Inspect dependency service and DNS",cmd:"kubectl get svc,endpoints -n data postgres",out:`service/postgres exists\nEndpoints: 10.244.2.31:5432\n\nRecheck the exact service name, namespace and DNS path from the Pod.`}
 ],
 cause:"The init container uses an incorrect database DNS name/namespace and exits before the application container can start.",
 fix:"Correct the dependency address, validate DNS and network policy, and make the init check use bounded retries/timeouts. Ensure the init container's image and permissions are valid.",
 verify:"kubectl logs orders-7c8d9b -n production -c wait-for-db\nkubectl describe pod orders-7c8d9b -n production",
 lesson:"Use -c to inspect the failing init container. The main container may have no logs because it has not started yet."
},
{
 id:"secretmount",title:"Secret volume / key mount failure",category:"Configuration & Access",severity:"Medium",level:"Intermediate",symptom:"Pod cannot mount a Secret or expected key file is missing.",tags:["secret","volume","key"],
 summary:"The referenced Secret/key is missing or the projected volume path/mode does not match the application.",
 first:"kubectl describe pod billing-7d9c9 -n production",
 output:`Warning FailedMount\nMountVolume.SetUp failed: references non-existent secret key "client.crt"`,
 steps:[
  {title:"Inspect mount event",cmd:"kubectl describe pod billing-7d9c9 -n production",out:`secret volume "client-tls" references missing key "client.crt"`},
  {title:"List Secret keys without revealing values",cmd:"kubectl describe secret billing-client-tls -n production",out:`Type: kubernetes.io/tls\nData\n====\ntls.crt:  1 item\ntls.key:  1 item\n\nExpected key client.crt does not exist.`},
  {title:"Review volume item mapping",cmd:"kubectl get deployment billing -n production -o yaml",out:`secret:\n  secretName: billing-client-tls\n  items:\n  - key: client.crt\n    path: client.crt\n\nSecret uses tls.crt / tls.key keys.`}
 ],
 cause:"The volume maps a key named client.crt that is not present in the Secret; the certificate key is named tls.crt.",
 fix:"Correct the key mapping or Secret structure through the approved certificate/secret management workflow. Do not output private key values or place them in source control.",
 verify:"kubectl describe secret billing-client-tls -n production\nkubectl describe pod billing-7d9c9 -n production",
 lesson:"Secret objects have keys, not just names. Validate the type, expected key names and mount paths while protecting the values."
},
{
 id:"priority",title:"Preemption / priority scheduling",category:"Scheduling & Resources",severity:"Medium",level:"Advanced",symptom:"High-priority Pod cannot schedule even after preemption is considered.",tags:["priorityclass","preemption","scheduler"],
 summary:"Priority, resource capacity, topology constraints or PodDisruptionBudgets prevent the pending workload from being scheduled.",
 first:"kubectl describe pod latency-api-7b6f -n production",
 output:`Warning FailedScheduling\n0/4 nodes are available: 2 Insufficient cpu, 2 node(s) didn't match pod topology spread constraints.\npreemption: no suitable victims found`,
 steps:[
  {title:"Inspect scheduling reason",cmd:"kubectl describe pod latency-api-7b6f -n production",out:`Priority: 100000\nRequests: cpu=4, memory=8Gi\nFailedScheduling: insufficient CPU and topology constraints.`},
  {title:"Check PriorityClass and node capacity",cmd:"kubectl get priorityclass\nkubectl describe nodes",out:`PriorityClass: latency-critical\nEligible nodes do not have 4 CPU and 8Gi allocatable headroom.`},
  {title:"Review topology and disruption constraints",cmd:"kubectl get pdb -A\nkubectl get pod latency-api-7b6f -n production -o yaml",out:`topologySpreadConstraints:\n  whenUnsatisfiable: DoNotSchedule\n  topologyKey: topology.kubernetes.io/zone\n\nNo eligible zone can satisfy the current placement and resource requirements.`}
 ],
 cause:"The Pod's resource requests and strict topology constraints cannot be satisfied. Priority alone cannot create capacity or override every scheduling rule.",
 fix:"Review requests, node pool capacity, topology spread rules and PDB constraints. Add appropriate capacity or adjust constraints only if the availability architecture permits it.",
 verify:"kubectl describe pod latency-api-7b6f -n production\nkubectl get nodes --show-labels",
 lesson:"Priority affects preemption decisions; it does not override hard affinity, topology, resource capacity or every disruption constraint."
}
];

const categories = ["All incidents", ...new Set(incidents.map(x=>x.category))];
const severityColor = s => s==="Critical"?"red":s==="High"?"orange":s==="Medium"?"yellow":"blue";

function App(){
 const [selected,setSelected] = useState(incidents[0].id);
 const [category,setCategory] = useState("All incidents");
 const [search,setSearch] = useState("");
 const [step,setStep] = useState(-1);
 const [revealed,setRevealed] = useState(false);
 const [completed,setCompleted] = useState([]);
 const [terminalCmd,setTerminalCmd] = useState("");
 const [terminalResult,setTerminalResult] = useState("");
 const [showTerminal,setShowTerminal] = useState(false);
 const [tab,setTab] = useState("investigate");
 const [mobileNav,setMobileNav] = useState(false);
 const current = incidents.find(x=>x.id===selected) || incidents[0];
 const filtered = useMemo(()=>incidents.filter(i=>(category==="All incidents"||i.category===category)&&(`${i.title} ${i.symptom} ${i.tags.join(" ")}`.toLowerCase().includes(search.toLowerCase()))),[category,search]);
 const commands = useMemo(()=>[current.first,...current.steps.map(s=>s.cmd),current.verify.split("\n")], [current]);
 const allCommands = useMemo(()=>[current.first,...current.steps.map(s=>s.cmd),...current.verify.split("\n")], [current]);
 function choose(id){setSelected(id);setStep(-1);setRevealed(false);setTerminalCmd("");setTerminalResult("");setShowTerminal(false);setTab("investigate");setMobileNav(false)}
 function runCommand(raw){
  const cmd=raw.trim();
  if(!cmd){setTerminalResult("Enter one of the suggested commands to view simulated output.");return}
  const match=allCommands.find(x=>x===cmd);
  if(match){
   const idx=current.steps.findIndex(s=>s.cmd===cmd);
   setTerminalResult(idx>=0?current.steps[idx].out:cmd===current.first?current.output:current.verify);
  } else {
   setTerminalResult("Command not in this scenario's simulation allowlist.\n\nThis lab never executes shell commands. Use one of the suggested diagnostic commands above, or select a matching command from the investigation steps.");
  }
  setShowTerminal(true);
 }
 function markDone(){setCompleted(prev=>prev.includes(current.id)?prev:[...prev,current.id])}
 return <div className="app-shell">
  <header className="topbar">
   <button className="brand" onClick={()=>choose(incidents[0].id)} aria-label="KubeLab home"><span className="brand-mark"><Layers3 size={21}/></span><span><strong>KubeLab</strong><small>INCIDENT SIMULATOR</small></span></button>
   <div className="top-center"><span className="live-dot"></span> LOCAL SIMULATION <span className="top-divider">/</span> <span>CLUSTER: prod-lab-01</span></div>
   <div className="top-actions"><span className="safe-pill"><ShieldAlert size={14}/> No live cluster</span><button className="icon-btn mobile-menu" onClick={()=>setMobileNav(!mobileNav)} aria-label="Toggle incidents"><Filter size={18}/></button></div>
  </header>
  <main className="layout">
   <aside className={`sidebar ${mobileNav?"sidebar-open":""}`}>
    <div className="side-heading"><div><span className="eyebrow">TRAINING ENVIRONMENT</span><h2>Incident library</h2></div><span className="count">{filtered.length}</span></div>
    <label className="searchbox"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search incidents..."/><kbd>/</kbd></label>
    <div className="category-select"><Filter size={14}/><select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select><ChevronDown size={14}/></div>
    <div className="incident-list">
     {filtered.map(item=><button key={item.id} className={`incident-item ${selected===item.id?"active":""}`} onClick={()=>choose(item.id)}>
      <span className={`incident-symbol ${severityColor(item.severity)}`}><AlertCircle size={16}/></span>
      <span className="incident-copy"><strong>{item.title}</strong><small>{item.category}</small></span>
      <span className={`severity-dot ${severityColor(item.severity)}`} title={item.severity}></span>
     </button>)}
     {filtered.length===0&&<div className="empty-state">No incidents match your search.</div>}
    </div>
    <div className="sidebar-bottom"><div className="progress-row"><span>Lab progress</span><strong>{completed.length}/{incidents.length}</strong></div><div className="progress-track"><span style={{width:`${completed.length/incidents.length*100}%`}}/></div><p>Complete investigations to track your practice.</p></div>
   </aside>
   <section className="workspace">
    <div className="breadcrumb"><span>Labs</span><ChevronRight size={14}/><span>Incident response</span><ChevronRight size={14}/><strong>{current.title}</strong></div>
    <div className="page-heading">
     <div><div className="eyebrow">KUBERNETES OPERATIONS <span className="heading-dot">•</span> {current.level.toUpperCase()}</div><h1>{current.title}</h1><p>{current.summary}</p></div>
     <div className={`severity-pill ${severityColor(current.severity)}`}><span></span>{current.severity} severity</div>
    </div>
    <div className="stats-strip">
     <div className="stat"><span className="stat-icon purple"><Server size={17}/></span><div><small>Cluster</small><strong>prod-lab-01</strong></div></div>
     <div className="stat"><span className="stat-icon blue"><Layers3 size={17}/></span><div><small>Namespace</small><strong>{current.category==="Storage"?"data":current.category==="Scheduling & Resources"?"production":"production"}</strong></div></div>
     <div className="stat"><span className="stat-icon orange"><Activity size={17}/></span><div><small>Scenario</small><strong>Simulated incident</strong></div></div>
     <div className="stat"><span className="stat-icon green"><CheckCircle2 size={17}/></span><div><small>Your status</small><strong>{completed.includes(current.id)?"Completed":"In progress"}</strong></div></div>
    </div>
    <div className="main-grid">
     <div className="primary-column">
      <section className="panel cluster-panel">
       <div className="panel-head"><div><span className="section-kicker">01 / ENVIRONMENT</span><h3>Cluster topology</h3></div><span className="mini-badge"><span className="green-dot"></span> Diagram is simulated</span></div>
       <div className="topology">
        <div className="control-plane"><div className="node-icon"><Layers3 size={20}/></div><div><strong>Control plane</strong><small>API server · scheduler · etcd</small></div><span className="health-tag ok">HEALTHY</span></div>
        <div className="connector"><span></span><span></span><span></span></div>
        <div className="workers">
         {["worker-01","worker-02","worker-03"].map((node,i)=><div className={`worker-card ${current.id==="node"&&i===1?"worker-alert":""}`} key={node}><div className="worker-head"><Server size={16}/><strong>{node}</strong><span className={`node-health ${current.id==="node"&&i===1?"bad":""}`}></span></div><div className="worker-meta">6 vCPU <span>•</span> 16 GiB RAM</div><div className="pod-stack">
          {[0,1].map((p)=><div className={`pod-chip ${i===1&&p===0?"pod-affected":""}`} key={p}><span className={`pod-state ${i===1&&p===0?"bad":""}`}></span><span>{i===1&&p===0?current.title:"app-pod-"+(i*2+p+1)}</span></div>)}
         </div></div>)}
        </div>
       </div>
       <div className="topology-legend"><span><i className="legend-green"></i>Healthy component</span><span><i className="legend-red"></i>Incident focus</span><span><i className="legend-gray"></i>Simulated resource</span></div>
      </section>
      <section className="panel investigation-panel">
       <div className="panel-head"><div><span className="section-kicker">02 / INVESTIGATION</span><h3>Work the incident</h3></div><span className="step-count">{Math.max(0,step+1)} / {current.steps.length+1} checks</span></div>
       <div className="tabbar"><button className={tab==="investigate"?"selected":""} onClick={()=>setTab("investigate")}><Terminal size={15}/> Diagnostics</button><button className={tab==="evidence"?"selected":""} onClick={()=>setTab("evidence")}><BookOpen size={15}/> Evidence & notes</button></div>
       {tab==="investigate"? <div className="diagnostics">
        <div className="step-list">
         <button className={`step-row ${step===-1?"current":""} ${step>=0?"done":""}`} onClick={()=>{setStep(-1);setRevealed(false)}}><span className="step-number">{step>=0?<Check size={14}/>: "1"}</span><span><strong>Establish the symptom</strong><small>Check the initial status</small></span><ChevronRight size={16}/></button>
         {current.steps.map((s,i)=><button key={s.title} className={`step-row ${step===i?"current":""} ${step>i?"done":""}`} onClick={()=>{setStep(i);setRevealed(false)}}><span className="step-number">{step>i?<Check size={14}/>:i+2}</span><span><strong>{s.title}</strong><small>Diagnostic command</small></span><ChevronRight size={16}/></button>)}
        </div>
        <div className="evidence-view">
         {step===-1?<><div className="evidence-title"><div><span className="terminal-label"><Terminal size={13}/> TERMINAL OUTPUT</span><h4>Initial symptom</h4></div><button className="subtle-btn" onClick={()=>{setTerminalCmd(current.first);runCommand(current.first)}}><Play size={13}/> Run simulated command</button></div><p className="evidence-desc">Start with the broad symptom. Do not change resources before understanding the failure.</p><CodePanel command={current.first} output={current.output}/></>:<><div className="evidence-title"><div><span className="terminal-label"><Terminal size={13}/> DIAGNOSTIC {String(step+1).padStart(2,"0")}</span><h4>{current.steps[step].title}</h4></div><button className="subtle-btn" onClick={()=>{setTerminalCmd(current.steps[step].cmd);runCommand(current.steps[step].cmd)}}><Play size={13}/> Run simulated command</button></div><div className="command-box"><code>{current.steps[step].cmd}</code><button title="Copy command" onClick={()=>navigator.clipboard?.writeText(current.steps[step].cmd)}><Copy size={14}/></button></div><div className="output-head"><span>SIMULATED STDOUT / STDERR</span><span>Read-only</span></div><pre className="terminal-output">{current.steps[step].out}</pre></>}
         <div className="investigation-controls"><button className="btn secondary" onClick={()=>{setStep(Math.max(-1,step-1));setRevealed(false)}} disabled={step===-1}><ArrowLeft size={15}/> Previous</button>{step<current.steps.length-1?<button className="btn primary" onClick={()=>{setStep(Math.min(current.steps.length-1,step+1));setRevealed(false)}}>Next diagnostic <ArrowRight size={15}/></button>:<button className="btn primary" onClick={()=>setRevealed(true)}>Analyze root cause <ChevronRight size={15}/></button>}</div>
        </div>
       </div>:<div className="notes-view"><div className="note-card"><BookOpen size={17}/><div><strong>Investigation checklist</strong><p>Record the symptom, collect events and logs, validate a hypothesis, then make the smallest safe change.</p></div></div><div className="checklist">{["I identified the first observable symptom","I inspected events and relevant logs","I checked configuration or resource constraints","I can explain why the symptom occurred"].map((x,i)=><label key={x}><input type="checkbox"/><span>{x}</span></label>)}</div><p className="muted-note">Checklist selections are local to this browser session and are not saved to a server.</p></div>}
      </section>
      {revealed&&<section className="panel solution-panel"><div className="solution-head"><span className="solution-icon"><CheckCircle2 size={19}/></span><div><span className="section-kicker">03 / ANALYSIS</span><h3>Root cause identified</h3></div><span className="health-tag ok">SOLUTION</span></div><div className="solution-block"><h4><CircleHelp size={16}/> Root cause</h4><p>{current.cause}</p></div><div className="solution-block"><h4><LifeBuoy size={16}/> Recommended remediation</h4><p>{current.fix}</p></div><div className="solution-block"><h4><CheckCircle2 size={16}/> Verify recovery</h4><CodePanel command="Verification commands" output={current.verify}/></div><div className="lesson-box"><BookOpen size={17}/><div><strong>What to remember</strong><p>{current.lesson}</p></div></div><button className="btn primary complete-btn" onClick={markDone}>{completed.includes(current.id)?<><Check size={16}/> Investigation completed</>:<><CheckCircle2 size={16}/> Mark incident complete</>}</button></section>}
     </div>
     <aside className="right-column">
      <section className="panel incident-card"><div className="panel-head compact"><div><span className="section-kicker">INCIDENT BRIEF</span><h3>What you know</h3></div><span className={`severity-pill small ${severityColor(current.severity)}`}><span></span>{current.severity}</span></div><div className="brief-row"><small>Symptom</small><p>{current.symptom}</p></div><div className="brief-row"><small>Initial command</small><div className="inline-command"><code>{current.first}</code><button title="Copy command" onClick={()=>navigator.clipboard?.writeText(current.first)}><Copy size={13}/></button></div></div><div className="brief-row"><small>Useful clues</small><div className="tags">{current.tags.map(t=><span key={t}>{t}</span>)}</div></div><div className="hint-box"><CircleHelp size={16}/><p><strong>Engineer’s hint</strong><br/>Use events and the exact error message to narrow the search. Avoid changing multiple things at once.</p></div></section>
      <section className="panel terminal-panel"><div className="panel-head compact"><div><span className="section-kicker">SANDBOX TERMINAL</span><h3>Command console</h3></div><span className="terminal-status">SIMULATED</span></div><p className="console-description">Run only scenario commands. Nothing is sent to a real cluster.</p><form onSubmit={e=>{e.preventDefault();runCommand(terminalCmd)}}><div className="console-input"><span>$</span><input value={terminalCmd} onChange={e=>setTerminalCmd(e.target.value)} placeholder="Enter suggested command..." aria-label="Simulated command"/></div><button className="btn primary run-btn" type="submit"><Play size={14}/> Run simulation</button></form>{showTerminal&&<div className="console-result"><div className="output-head"><span>OUTPUT</span><button onClick={()=>setShowTerminal(false)} aria-label="Close output"><X size={13}/></button></div><pre>{terminalResult}</pre></div>}<div className="suggested-commands"><small>TRY A DIAGNOSTIC</small>{current.steps.slice(0,3).map(s=><button key={s.cmd} onClick={()=>setTerminalCmd(s.cmd)}><Terminal size={13}/><span>{s.cmd}</span><ChevronRight size={13}/></button>)}</div></section>
      <section className="panel learning-panel"><div className="learning-icon"><Gauge size={18}/></div><div><h3>Build the habit</h3><p>Observe → Hypothesize → Test → Remediate → Verify.</p><span>{current.level} scenario</span></div></section>
     </aside>
    </div>
    <footer><span><ShieldAlert size={14}/> Training environment only — no cluster connection</span><span>KubeLab <b>•</b> {incidents.length} scenarios <b>•</b> Vercel-ready</span></footer>
   </section>
  </main>
 </div>
}
function CodePanel({command,output}){return <div className="code-panel"><div className="code-head"><span><i></i><i></i><i></i></span><small>{command}</small><button title="Copy output" onClick={()=>navigator.clipboard?.writeText(output)}><Copy size={13}/></button></div><pre>{output}</pre></div>}
createRoot(document.getElementById("root")).render(<App/>);
