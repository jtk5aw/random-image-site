# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands
- Web Frontend: `cd packages/images-frontend && npm start` (dev), `npm run build` (production)
- Rust Backend: `cd packages/images-api && cargo build` (all lambdas)
- Rust Lambda test: `cd packages/images-api/<lambda_name> && cargo test`
- TypeScript Backend: `npx sst dev` (from project root)
- Mobile App: `cd packages/mobile-app && npm start` 
- Deploy: `npx sst deploy --stage production` (from project root)

## Test Commands
- Frontend: `cd packages/images-frontend && npm test` (runs Jest tests)
- Rust Backend: `cd packages/images-api && cargo test` (runs all tests)
- Single Rust test: `cd packages/images-api/<lambda_name> && cargo test <test_name> -- --nocapture`
- Infra tests: `cd infra && npm run test`

## Lint Commands
- Rust Backend: `cd packages/images-api && cargo clippy`
- Rust Backend format: `cd packages/images-api && cargo fmt`
- TypeScript lint: `npm run lint` (from project root)

## Code Style Guidelines
- **Frontend**: Use functional components with hooks (not class components)
- **Backend**: Follow Rust documentation style with `///` for function docs
- **Function docs**: Include `# Arguments` and `# Result` sections in Rust
- **Error handling**: Use Result/Option in Rust; try/catch in JS/TS
- **Types**: Use strong typing in TypeScript; avoid `any`
- **Formatting**: Maintain consistent indentation (2 spaces JS/TS, 4 spaces Rust)
- **Naming**: camelCase for JS/TS variables/functions, PascalCase for components, snake_case for Rust
- **Imports**: Group by external/internal/local, alphabetize within groups

## Project Structure
- `/packages/images-api`: Rust lambdas for image-related functionality
  - `/daily_setup_lambda`: Lambda for daily image selection
  - `/get_image_lambda`: Lambda for retrieving the current image
  - `/get_or_set_reaction_lambda`: Lambda for handling image reactions
  - `/set_favorite_recent_lambda`: Lambda for setting favorites
  - `/lambda_utils`: Shared utilities for all Rust lambdas
- `/packages/images-frontend`: React frontend for web display
- `/packages/mobile-app`: Mobile application (React Native/Expo)
- `/packages/mobile-backend`: TypeScript backend for mobile API
- `/random-image-site-discord-bot`: Discord bot (Rust)
- `/infra`: Legacy infrastructure code

## Key Components

### Backend:
- **Rust Backend**: AWS Lambda functions for core image functionality
  - DynamoDB for image and reaction data
  - S3 for image storage
  - Daily selection of random images
  
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

### Web Frontend:
- React application for displaying daily images
- Reaction functionality for images
- Responsive design

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