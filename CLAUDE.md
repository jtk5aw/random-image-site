# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands
- Web Frontend: `cd frontend && npm start` (dev), `npm run build` (production)
- Rust (Old) Backend: `cd backend && cargo build` (all lambdas)
- Rust Lambda test: `cd backend/<lambda_name> && cargo test`
- Old Infrastructure: `cd infra && npm run build`
- TypeScript (New) Backend: `cd packages/mobile-backend && npx sst dev` 
- Mobile App: N/A for now.
But located in `packages/mobile-app`
- Deploy: `npx sst deploy --stage production`

## Test Commands
- Frontend: `cd frontend && npm test` (runs Jest tests)
- Backend: `cd backend && cargo test` (runs all tests)
- Single Rust test: `cd backend/<lambda_name> && cargo test <test_name> -- --nocapture`
- Infra tests: `cd infra && npm run test`

## Lint Commands
- Backend: `cd backend && cargo clippy`
- Backend format: `cd backend && cargo fmt`

## Code Style Guidelines
- **Frontend**: Use functional components with hooks (not class components)
- **Backend**: Follow Rust documentation style with `///` for function docs
- **Function docs**: Include `# Arguments` and `# Result` sections in Rust
- **Error handling**: Use Result/Option in Rust; try/catch in JS/TS
- **Types**: Use strong typing in TypeScript; avoid `any`
- **Formatting**: Maintain consistent indentation (2 spaces JS/TS, 4 spaces Rust)
- **Naming**: camelCase for JS/TS variables/functions, PascalCase for components, snake_case for Rust
- **Imports**: Group by external/internal/local, alphabetize within groups

## Key Components

### Backend:
- **TypeScript Backend**: Uses Hono web framework with AWS Lambda
  - Authentication via JWT tokens (Apple auth) with refresh token mechanism
  - DynamoDB for user data and rate limiting
  - S3 for image storage with presigned URLs
  - Rate limiting for uploads (10 per hour)

### Mobile App:
- iOS share extension for uploading images
- Authentication stored in keychain
- Network calls with token refresh capability
- Two-step upload process: 
  1. Get presigned URL from backend
  2. Upload image to S3 directly

### Infrastructure:
- SST for deployment management
- Resources include:
  - DynamoDB tables
  - S3 buckets
  - AWS Secrets
  - Lambda functions
  - API Gateway

### Authentication Flow:
- Apple authentication
- JWT tokens for authorization
- Access token/refresh token pattern
- Keychain storage on mobile
