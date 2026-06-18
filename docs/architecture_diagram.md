# ChronosAI Logical Architecture Specification

This document maps out the logical component relations, data pipelines, and security authorization boundaries established for Project ChronosAI.

## System Architecture Diagram

The diagram below details the end-to-end telemetry pathways and forecasting data integrations:

```mermaid
graph TB
    subgraph Users ["Clients & Consumers"]
        Fnt[Web Dashboard Interface]
        API[External Financial API Clients]
    end

    subgraph K8s ["Amazon EKS Cluster boundary (us-east-1)"]
        ING[ALB Ingress Controller] -->|Port 80/443| SVC[Kubernetes Service]
        SVC -->|Round-Robin load balance| POD1[ChronosAI Node.js Pod 1]
        SVC -->|Round-Robin load balance| POD2[ChronosAI Node.js Pod 2]
        SVC -->|Round-Robin load balance| POD3[ChronosAI Node.js Pod 3]
        
        POD_ALL[ChronosAI Pods] -.->|Retrieve DB Passwords| Vault[HashiCorp Vault Service]
        POD_ALL -.->|Expose metric metrics| PromScrap[Prometheus Daemon]
        
        Filebeat[Filebeat Sidecar] -->|Read stdout logs| POD_ALL
    end

    subgraph Security_Databases ["Secured Tier"]
        Vault -->|Auto-Seal/Lock| VaultStorage[Vault persistent file storage]
        POD_ALL -->|Query macro indices| PG[(AWS Aurora PostgreSQL cluster)]
    end

    subgraph Telemetry ["Observability Infrastructure"]
        PromScrap -->|Scrape metrics| Grafana[Grafana Dashboard UI]
        Filebeat -->|Ship log events| Logstash[Logstash Indexing Pipeline]
        Logstash -->|Store records| ES[Elasticsearch Engine]
        ES -->|Visualize logs| Kibana[Kibana Dashboard UI]
    end

    Fnt -->|HTTPS queries| ING
    API -->|REST queries| ING
```

## Telemetry Pathways

1. **Macroeconomic Ingestion**: Data sources transmit commodity index changes, logistics score drops, and geopolitical indicators. Analytical processing models calculate GDP growth metrics.
2. **Scrape Route**: Prometheus pulls telemetry indicators from `/api/sim-metrics` every 5 seconds.
3. **Log Collection**: Container logs generated on `stdout` are read by Filebeat and piped to Logstash for indexing.
4. **Secret Rotations**: Credentials are recovered during pod startup via JWT vault authentication. If suspicious intrusion signatures are raised, Vault seals itself.
