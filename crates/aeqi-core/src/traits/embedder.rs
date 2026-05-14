use async_trait::async_trait;

#[async_trait]
pub trait Embedder: Send + Sync {
    async fn embed(&self, text: &str) -> anyhow::Result<Vec<f32>>;
    fn dimensions(&self) -> usize;

    /// Stable provider identifier for the embedding vector space.
    ///
    /// Backends that do not override this use a deterministic test/local
    /// profile. Production providers should return a real provider slug.
    fn provider(&self) -> &str {
        "unknown"
    }

    /// Stable model identifier for the embedding vector space.
    ///
    /// Search only compares vectors written by the active provider/model
    /// profile, so production providers must expose the configured model.
    fn model(&self) -> &str {
        "unknown"
    }
}
