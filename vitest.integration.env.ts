try {
  process.loadEnvFile(".env");
} catch {
  // Vars may already be in the environment.
}
