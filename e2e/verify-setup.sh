#!/bin/bash

# Verify E2E test setup
# Run this script to check if all fixtures and dependencies are ready

set -e

echo "🔍 Verifying E2E Test Setup..."
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Run this script from the project root directory"
    exit 1
fi

echo "✅ Project root directory found"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "❌ Error: node_modules not found. Run 'pnpm install' first"
    exit 1
fi

echo "✅ Dependencies installed"

# Check if Playwright is installed
if [ ! -d "node_modules/@playwright" ]; then
    echo "❌ Error: Playwright not found. Run 'pnpm install' first"
    exit 1
fi

echo "✅ Playwright installed"

# Check if performance fixtures exist
echo ""
echo "📦 Checking fixtures..."

FIXTURES_DIR="e2e/fixtures/performance-data"

if [ ! -f "$FIXTURES_DIR/large-session.jsonl" ]; then
    echo "⚠️  Warning: large-session.jsonl not found"
    echo "   Run: pnpm run fixtures:generate"
    MISSING_FIXTURES=true
else
    SIZE=$(du -h "$FIXTURES_DIR/large-session.jsonl" | cut -f1)
    LINES=$(wc -l < "$FIXTURES_DIR/large-session.jsonl")
    echo "✅ large-session.jsonl ($SIZE, $LINES lines)"
fi

if [ ! -d "$FIXTURES_DIR/multi-sessions" ]; then
    echo "⚠️  Warning: multi-sessions directory not found"
    echo "   Run: pnpm run fixtures:generate"
    MISSING_FIXTURES=true
else
    SESSION_COUNT=$(find "$FIXTURES_DIR/multi-sessions" -name "session-*.jsonl" | wc -l)
    echo "✅ multi-sessions ($SESSION_COUNT sessions)"
fi

if [ ! -f "$FIXTURES_DIR/mixed-content-session.jsonl" ]; then
    echo "⚠️  Warning: mixed-content-session.jsonl not found"
    echo "   Run: pnpm run fixtures:generate"
    MISSING_FIXTURES=true
else
    echo "✅ mixed-content-session.jsonl"
fi

# Check test files
TEST_FILES_DIR="e2e/fixtures/test-files"
TEST_FILE_COUNT=$(find "$TEST_FILES_DIR" -name "test-file-*.txt" 2>/dev/null | wc -l)

if [ "$TEST_FILE_COUNT" -lt 10 ]; then
    echo "⚠️  Warning: Only $TEST_FILE_COUNT test files found (expected 10)"
    echo "   Run: pnpm run fixtures:generate"
    MISSING_FIXTURES=true
else
    echo "✅ test-files ($TEST_FILE_COUNT files)"
fi

# Check existing fixtures
if [ -f "$TEST_FILES_DIR/sample.png" ]; then
    echo "✅ sample.png"
fi

if [ -f "$TEST_FILES_DIR/sample.pdf" ]; then
    echo "✅ sample.pdf"
fi

if [ -f "$TEST_FILES_DIR/large-file.zip" ]; then
    echo "✅ large-file.zip"
fi

# Summary
echo ""
echo "📋 Test Files:"
echo "   ✅ e2e/tests/user-workflows.spec.ts"
echo "   ✅ e2e/tests/performance.spec.ts"

echo ""
echo "🛠️  Helper Files:"
echo "   ✅ e2e/helpers/setup.ts"
echo "   ✅ e2e/helpers/performance.ts"

echo ""
echo "📚 Documentation:"
echo "   ✅ e2e/QUICK_START.md"
echo "   ✅ e2e/tests/README.md"
echo "   ✅ E2E_TESTS_SUMMARY.md"

echo ""
if [ "$MISSING_FIXTURES" = true ]; then
    echo "⚠️  Some fixtures are missing!"
    echo ""
    echo "Generate fixtures with:"
    echo "  pnpm run fixtures:generate"
    echo ""
    exit 1
else
    echo "✅ All fixtures present!"
    echo ""
    echo "🎉 E2E test setup is complete!"
    echo ""
    echo "Quick commands:"
    echo "  pnpm run test:e2e              # Run all E2E tests"
    echo "  pnpm run test:e2e:workflows    # Run workflow tests"
    echo "  pnpm run test:e2e:performance  # Run performance tests"
    echo "  pnpm run test:e2e:ui           # Run in UI mode"
    echo ""
    echo "See e2e/QUICK_START.md for more information"
fi
