# AWS Account Connection — Sequence Flow

Complete end-to-end sequence diagrams for the AWS cross-account connection
workflow in Infra Genie.

---

## 1. Full Connection Flow

```
User                Infra Genie Frontend        FastAPI Backend         AWS (Customer Account)
 │                        │                        │                          │
 │  Enter Account ID       │                        │                          │
 │  + Region               │                        │                          │
 ├───────────────────────►│                        │                          │
 │                        │  POST /api/cloud/      │                          │
 │                        │  aws/connect           │                          │
 │                        ├───────────────────────►│                          │
 │                        │                        │ Validate Account ID      │
 │                        │                        │ Validate Region          │
 │                        │                        │ Generate External ID     │
 │                        │                        │ (uuid.uuid4())           │
 │                        │                        │ Create DB record         │
 │                        │                        │ status = PENDING         │
 │                        │                        │ Generate CFN template    │
 │                        │                        │ (with ExternalId baked   │
 │                        │                        │  into trust policy)      │
 │                        │◄───────────────────────┤                          │
 │                        │  { connection_id,       │                          │
 │                        │    external_id,         │                          │
 │                        │    cfn_template }       │                          │
 │◄───────────────────────┤                        │                          │
 │  Show Step 1 UI:        │                        │                          │
 │  External ID            │                        │                          │
 │  CFN template download  │                        │                          │
 │  Launch Stack button    │                        │                          │
 │                        │                        │                          │
 │  Download CFN template  │                        │                          │
 ├───────────────────────►│                        │                          │
 │  (JSON file saved       │                        │                          │
 │   to local disk)        │                        │                          │
 │                        │                        │                          │
 │  Open AWS CloudFormation│                        │                          │
 │  Console                │                        │                          │
 │  Upload CFN template    │                        │                          │
 │  Create stack           │                        │                          │
 │─────────────────────────────────────────────────────────────────────────►│
 │                        │                        │  CloudFormation creates  │
 │                        │                        │  InfraGenieExecutionRole   │
 │                        │                        │  with:                   │
 │                        │                        │  • Trust: Infra Genie       │
 │                        │                        │    account only          │
 │                        │                        │  • Condition: ExternalId │
 │                        │                        │  • Policy: AdminAccess   │
 │                        │                        │    (TESTING ONLY)        │
 │◄─────────────────────────────────────────────────────────────────────────┤
 │  Stack: CREATE_COMPLETE │                        │                          │
 │  Output: RoleArn        │                        │                          │
 │                        │                        │                          │
 │  Copy RoleArn           │                        │                          │
 │  (from CFN Outputs tab) │                        │                          │
 │                        │                        │                          │
 │  Paste RoleArn          │                        │                          │
 │  in Infra Genie Step 2     │                        │                          │
 ├───────────────────────►│                        │                          │
 │                        │  POST /api/cloud/aws/  │                          │
 │                        │  {id}/verify           │                          │
 │                        │  { role_arn }          │                          │
 │                        ├───────────────────────►│                          │
 │                        │                        │ Validate ARN format      │
 │                        │                        │ Validate account ID      │
 │                        │                        │  matches stored record   │
 │                        │                        │ Update DB:               │
 │                        │                        │  status = VERIFYING      │
 │                        │                        │                          │
```

---

## 2. STS AssumeRole Detail

```
FastAPI Backend                  AWS STS                   Customer AWS Account
       │                              │                              │
       │  assume_role(                │                              │
       │    RoleArn,                  │                              │
       │    ExternalId,               │                              │
       │    RoleSessionName,          │                              │
       │    DurationSeconds=900       │                              │
       │  )                           │                              │
       ├─────────────────────────────►│                              │
       │                              │  Validate Principal          │
       │                              │  (Infra Genie Account ID?)      │
       │                              │  Validate ExternalId         │
       │                              │  (matches trust policy?)     │
       │                              ├─────────────────────────────►│
       │                              │  Grant temporary credentials │
       │                              │◄─────────────────────────────┤
       │◄─────────────────────────────┤                              │
       │  { AccessKeyId,              │                              │
       │    SecretAccessKey,  ◄── NEVER stored, never logged         │
       │    SessionToken,     ◄── NEVER returned to frontend         │
       │    Expiration }      ◄── Valid for 15 minutes only          │
       │                              │                              │
       │  Build boto3.Session         │                              │
       │  (in-memory only)            │                              │
       │                              │                              │
       │  get_caller_identity()       │                              │
       ├─────────────────────────────►│                              │
       │                              ├─────────────────────────────►│
       │                              │◄─────────────────────────────┤
       │◄─────────────────────────────┤                              │
       │  { Account: "222...",        │                              │
       │    Arn: "arn:aws:sts::..." } │                              │
       │                              │                              │
       │  Assert: Account ==          │                              │
       │    stored account_id         │                              │
       │  ✅ Match → continue         │                              │
       │  ❌ Mismatch → FAILED        │                              │
       │                              │                              │
       │  ec2.describe_regions()      │                              │
       ├────────────────────────────────────────────────────────────►│
       │◄────────────────────────────────────────────────────────────┤
       │  [ list of regions ]         │                              │
       │                              │                              │
       │  Update DB:                  │                              │
       │    status = CONNECTED        │                              │
       │    last_verified_at = now()  │                              │
       │    role_arn = <stored>       │                              │
       │                              │                              │
       │  boto3.Session GC'd          │                              │
       │  Credentials no longer exist │                              │
```

---

## 3. Success Response Flow

```
FastAPI Backend        Infra Genie Frontend              User
       │                        │                       │
       │  {                     │                       │
       │    status: CONNECTED,  │                       │
       │    account_id: "222…", │                       │
       │    region: "ap-…",     │                       │
       │    role_arn: "arn:…",  │                       │
       │    last_verified_at    │                       │
       │  }                     │                       │
       ├───────────────────────►│                       │
       │                        │  Show Step 3:         │
       │                        │  ✅ Connected!         │
       │                        │  Account: 222…        │
       │                        │  Region: ap-south-1   │
       │                        │  Role: InfraGenieExec… │
       │                        ├──────────────────────►│
       │                        │                       │  Click "Done"
       │                        │◄──────────────────────┤
       │                        │  Reload account list  │
       │                        │  Show account card:   │
       │                        │  🟢 Connected         │
```

---

## 4. Failure Flow

```
FastAPI Backend        Infra Genie Frontend              User
       │                        │                       │
       │  STS returns            │                       │
       │  AccessDenied           │                       │
       │                        │                       │
       │  Update DB:             │                       │
       │    status = FAILED      │                       │
       │    connection_error =   │                       │
       │    "AWS role assumption │                       │
       │     was denied…"        │                       │
       │                        │                       │
       │  {                     │                       │
       │    status: FAILED,     │                       │
       │    error_code:         │                       │
       │      AccessDenied,     │                       │
       │    message: "…"        │                       │
       │  }                     │                       │
       ├───────────────────────►│                       │
       │                        │  Show error in Step 2 │
       │                        │  (red box with msg)   │
       │                        ├──────────────────────►│
       │                        │                       │  Fix IAM trust policy
       │                        │                       │  in AWS console
       │                        │                       │  Click "Verify Again"
       │                        │◄──────────────────────┤
       │                        │  POST /verify again    │
       │                        ├───────────────────────►
       │                        │  (retry flow)          │
```

---

## 5. Disconnect Flow

```
User             Infra Genie Frontend        FastAPI Backend
 │                       │                       │
 │  Click "Disconnect"   │                       │
 ├──────────────────────►│                       │
 │                       │  Confirm dialog       │
 │◄──────────────────────┤                       │
 │  "This removes the    │                       │
 │   connection from     │                       │
 │   Infra Genie. Delete    │                       │
 │   the CFN stack to    │                       │
 │   fully revoke…"      │                       │
 │                       │                       │
 │  Confirm              │                       │
 ├──────────────────────►│                       │
 │                       │  DELETE /api/cloud/   │
 │                       │  aws/{id}             │
 │                       ├──────────────────────►│
 │                       │                       │  Update DB:
 │                       │                       │    status = DISCONNECTED
 │                       │                       │
 │                       │◄──────────────────────┤
 │                       │  { status:            │
 │                       │    DISCONNECTED }     │
 │                       │                       │
 │                       │  Update account card  │
 │                       │  ⚫ Disconnected       │
 │◄──────────────────────┤                       │
 │                       │                       │
 │  (Optional) User goes to AWS console          │
 │  Deletes CloudFormation stack                 │
 │  IAM role permanently removed from account   │
```

---

## 6. Database State Machine

```
                    ┌─────────────────────────────────────┐
                    │                                     │
                    ▼                                     │
              ┌─────────┐                                │
              │ PENDING │  POST /aws/connect creates      │
              │         │  record here                    │
              └────┬────┘                                │
                   │                                     │
                   │  POST /aws/{id}/verify called        │
                   ▼                                     │
            ┌───────────┐                               │
            │ VERIFYING │  STS AssumeRole in progress    │
            └─────┬─────┘                               │
                  │                                     │
         ┌────────┴────────┐                           │
         │                 │                           │
         ▼                 ▼                           │
   ┌───────────┐     ┌────────┐                       │
   │ CONNECTED │     │ FAILED │──────────────────────►│
   └─────┬─────┘     └────────┘  User fixes trust      │
         │                       policy, retries        │
         │  DELETE /aws/{id}                            │
         ▼                                             │
   ┌──────────────┐                                   │
   │ DISCONNECTED │                                   │
   └──────────────┘                                   │
                                                      │
         Any FAILED account can retry                  │
         (POST /verify again) ────────────────────────┘
```

---

## 7. Security Boundary Summary

```
                    ┌─────────────────────────────────────────┐
                    │            Infra Genie System               │
                    │                                          │
                    │  Frontend (Browser)                      │
                    │  ┌────────────────────────────────────┐  │
                    │  │  • Shows External ID once           │  │
                    │  │  • Never receives credentials       │  │
                    │  │  • Never receives External ID again │  │
                    │  └───────────────┬────────────────────┘  │
                    │                  │ HTTPS + JWT            │
                    │  Backend (FastAPI)│                        │
                    │  ┌───────────────▼────────────────────┐  │
                    │  │  • Generates External ID            │  │
                    │  │  • Stores external_id (DB only)     │  │
                    │  │  • Calls STS AssumeRole             │  │
                    │  │  • Uses credentials in-memory only  │  │
                    │  │  • Scopes all queries by user_id    │  │
                    │  └───────────────┬────────────────────┘  │
                    │                  │ AWS STS API            │
                    └──────────────────┼──────────────────────-┘
                                       │
                    ┌──────────────────▼──────────────────────┐
                    │        Customer AWS Account              │
                    │                                          │
                    │  InfraGenieExecutionRole                   │
                    │  • Trust: Infra Genie account only          │
                    │  • Condition: ExternalId match required  │
                    │  • Policy: AdministratorAccess (testing) │
                    │                                          │
                    │  Customer can revoke at any time by:     │
                    │  deleting the CloudFormation stack        │
                    └──────────────────────────────────────────┘
```

---

*Last updated: September 2026*  
*See [aws-connection.md](./aws-connection.md) for full architectural documentation.*
