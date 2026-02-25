RUNTIME_WAILSJS := ../omniviewdev-runtime/src/wailsjs

sync:
	# sync the generated Wails bindings from the runtime package
	cp -r $(RUNTIME_WAILSJS)/go/ ./internal/
	cp -r $(RUNTIME_WAILSJS)/runtime ./internal/
	# append context.Context stub (Wails codegen omits Go stdlib types)
	@echo '' >> ./internal/models.ts
	@echo '/**' >> ./internal/models.ts
	@echo ' * Stub for Go'\''s context.Context.' >> ./internal/models.ts
	@echo ' * Wails codegen references context.Context in .d.ts files but never emits' >> ./internal/models.ts
	@echo ' * a TypeScript definition for Go stdlib types. At runtime Wails injects' >> ./internal/models.ts
	@echo ' * the context automatically — JS callers never pass it.' >> ./internal/models.ts
	@echo ' */' >> ./internal/models.ts
	@echo 'export namespace context {' >> ./internal/models.ts
	@echo '	export type Context = any;' >> ./internal/models.ts
	@echo '}' >> ./internal/models.ts
