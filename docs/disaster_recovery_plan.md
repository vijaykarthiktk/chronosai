# ChronosAI Disaster Recovery (DR) Plan

ChronosAI is a critical global economic forecasting infrastructure. This document outlines the Business Continuity and Disaster Recovery (BCDR) plan to comply with strict operational standards.

---

## 1. DR KPIs & Objectives

| Metric | Target Objective | Definition |
| :--- | :--- | :--- |
| **RTO** (Recovery Time Objective) | **< 30 Seconds** | Target duration to restore operations after a regional service loss. |
| **RPO** (Recovery Point Objective) | **< 5 Seconds** | Maximum acceptable data age lost during failover events. |
| **Availability SLA** | **99.99%** | Yearly service availability targets. |

---

## 2. Infrastructure Resilience Architecture

ChronosAI employs a **Multi-Region Active-Passive (Warm Standby)** architecture:

*   **Primary Region (`us-east-1`)**: Hosts the primary active EKS cluster, active databases, and routing endpoints.
*   **Secondary Region (`eu-west-1`)**: Configured with a mirror EKS deployment and standby database.
*   **DNS Failover**: Managed via AWS Route 53 with latency-based routing policies and health check monitors.

```
                  [ AWS Route 53 DNS Resolver ]
                    /                        \
      (Healthy - 100% Traffic)        (Unhealthy - Failover Trigger)
                  /                            \
      [ Primary (us-east-1) ]             [ Secondary (eu-west-1) ]
       - EKS Active Cluster                 - EKS Standby Cluster
       - PostgreSQL Primary (Write)         - PostgreSQL Read-Replica (Promote)
```

---

## 3. Disruption Scenarios & Remediation Pipelines

### Disruption A: Single Pod Failure / Crash Loop
*   **Detection**: Kubernetes readiness/liveness probes fail (`/api/state`).
*   **Remediation**: K8s kubelet automatically terminates the unhealthy container and spawns a fresh pod according to the restart policy.

### Disruption B: Sudden Traffic Spike (Macro Crisis)
*   **Detection**: Prometheus alerts identify request rates exceeding 1000 rps and CPU loads > 60%.
*   **Remediation**: 
    1. Horizontal Pod Autoscaler (HPA) triggers pod scale-up from 3 to 10 replicas.
    2. AWS Cluster Autoscaler adds EC2 worker nodes if resource allocations exceed cluster limits.

### Disruption C: Full Cloud-Region Outage (us-east-1 failure)
*   **Detection**: Route 53 health check endpoints fail to respond for 15 seconds.
*   **Remediation**:
    1. Route 53 shifts DNS traffic to `eu-west-1` endpoints.
    2. The secondary database in `eu-west-1` is promoted from a read-replica to the primary write database.
    3. The application environment is marked operational.

### Disruption D: Cyber Attack / Compromised API Keys
*   **Detection**: WAF identifies massive API token validation errors; intrusion scanner raises alerts.
*   **Remediation**:
    1. Vault triggers an Auto-Seal to prevent credential extraction.
    2. Vault admin issues Shamir split keys to unseal once endpoints are secure.
    3. Kubernetes initiates a secret rotation, redeploying containers with fresh access tokens.

---

## 4. Runbooks & Verification Drills

To maintain operational continuity, automated DR verification drills must be performed quarterly:

1.  **Simulated Failover Command**:
    ```bash
    # Manually trigger routing failover by shifting route weights in AWS Route 53
    aws route53 change-resource-record-sets --hosted-zone-id Z3MJK8124 --change-batch file://dr-failover-weights.json
    ```
2.  **Database Promotion Command**:
    ```bash
    # Promote standby database replica to standalone primary instance in target region
    aws rds promote-read-replica --db-instance-identifier chronosai-db-standby-eu
    ```
3.  **Rollback Command**:
    ```bash
    # Once primary region recovers, restore traffic back to primary cluster
    aws route53 change-resource-record-sets --hosted-zone-id Z3MJK8124 --change-batch file://dr-rollback-weights.json
    ```
