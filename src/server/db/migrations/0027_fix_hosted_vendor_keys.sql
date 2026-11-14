-- Catalog fills used to take the vendor from the hosting provider (azure,
-- google-vertex, sensenova, ...) even for other labs' models. Re-derive it
-- from the model id with the same ordered rules as VENDOR_RULES in
-- src/lib/model-vendor.ts; ids no rule matches keep their host-derived key.
UPDATE "provider_models"
SET "vendor_key" = CASE
    WHEN "model_id" ~* 'claude' THEN 'anthropic'
    WHEN "model_id" ~* 'gemini|gemma' THEN 'google'
    WHEN "model_id" ~* 'deepseek' THEN 'deepseek'
    WHEN "model_id" ~* 'qwen|qwq|tongyi' THEN 'alibaba'
    WHEN "model_id" ~* 'glm|chatglm' THEN 'zhipuai'
    WHEN "model_id" ~* 'kimi|moonshot' THEN 'moonshotai'
    WHEN "model_id" ~* 'sensenova|sensetime|sensecore' THEN 'sensenova'
    WHEN "model_id" ~* 'llama' THEN 'meta'
    WHEN "model_id" ~* 'mistral|mixtral|codestral' THEN 'mistral'
    WHEN "model_id" ~* 'grok' THEN 'xai'
    WHEN "model_id" ~* 'gpt-|chatgpt|^o[1-9]|davinci' THEN 'openai'
    ELSE "vendor_key"
  END
WHERE "metadata_source" = 'catalog';
