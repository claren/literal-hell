# literal-hell

**Escape the pain. One string at a time.**

A command-line exorcist for HTML entity hellscapes. It hunts down unescaped string literals (quotes, ampersands, angle brackets—-the usual suspects) and helps you fix them before the linter explodes, Vercel has a panic attack, or the browser cries. Interactive, fast, and just smart enough to run for office.

## Installation

```bash
# Install globally
npm install -g literal-hell

# Or install locally in your project
npm install --save-dev literal-hell
```

Requirements:
- Node.js 14.x or higher

## Usage

Run the tool in your project directory:

```bash
# Basic usage
literal-hell

# Get help
literal-hell --help   # or -h

# Show version information
literal-hell --version   # or -v

# Show detailed logs
literal-hell --verbose

# Force prompt for all fixes (no auto-skipping)
literal-hell --strict

# Clear rejection history (re-check previously skipped items)
literal-hell --clear-history
```

### Interactive Commands

When prompted about a potential fix:
- Press `y` (or Enter): Apply the fix
- Press `n`: Skip this fix and remember for future runs
- Press `q`: Save changes and exit
- Press `c`: Show surrounding code context before deciding

By default, the tool will auto-skip common patterns like CSS selectors, font declarations, and URL parameters. Use `--strict` to review all potential fixes.

## How It Works

The tool:
1. Scans JavaScript, TypeScript, JSX, and TSX files in your project
2. Detects string literals that need HTML entity escaping
3. Interactively prompts you to apply fixes
4. Remembers which fixes you've rejected to avoid re-prompting
5. Auto-skips common patterns that don't need escaping

Escaped characters:
- `"` becomes `&quot;`
- `'` becomes `&apos;`
- `&` becomes `&amp;`
- `<` becomes `&lt;`
- `>` becomes `&gt;`

### Generated Files

The tool creates a `.literal-hell-wards` file in your project directory to store:
- Fixes you've explicitly rejected
- Patterns automatically skipped by the detection system

It's recommended to add this file to your `.gitignore`:

```
# literal-hell history file
.literal-hell-wards
```

This prevents the rejection history from being shared between developers, as preferences for which strings to escape may vary across projects and teams.

## For Developers

### Code Structure

The tool is organized into several modules in the `src/lib` directory:

- `index.js` - Main entry point that handles CLI arguments and orchestrates the process
- `eslint.js` - ESLint integration using Vercel's Next.js ESLint config to find unescaped entities
- `processor.js` - Core file processing logic, handles applying fixes and user interaction
- `ast.js` - AST traversal for finding string literals that need escaping
- `fixes.js` - Manages the rejection history and fix tracking
- `ui.js` - User interface components (context display, keypress handling)
- `logger.js` - Logging utilities with color-coded output
- `file.js` - File I/O operations and safety checks
- `escape.js` - String escaping logic and pattern detection
- `config.js` - Global configuration and constants

### How It Works

1. **File Discovery**
   - Uses `globby` to find JavaScript/TypeScript files
   - Ignores common directories like `node_modules`, `dist`, `build`

2. **Entity Detection**
   - Primary method: Uses ESLint with Vercel's Next.js config to find unescaped entities
   - Fallback method: AST traversal for string literals and JSX text nodes
   - Detects quotes (`'`, `"`), ampersands (`&`), and angle brackets (`<`, `>`)

3. **Fix Processing**
   - Groups fixes by file for efficient processing
   - Shows context around each fix (3 lines by default, 7 lines with 'c')
   - Handles both JSX text nodes and string literals differently
   - Preserves whitespace and formatting
   - Prevents double-escaping of already escaped entities

4. **Safety Features**
   - Verifies file modifications before writing
   - Checks for corrupted escapes
   - Handles multiline text carefully
   - Preserves JSX tags and attributes
   - Tracks rejected fixes to avoid re-prompting

5. **User Interaction**
   - Interactive prompts for each fix
   - Context viewing with line numbers
   - Clear success/error messages
   - Progress logging with color coding

### Development

To work on the tool:

```bash
# Clone the repository
git clone https://github.com/claren/literal-hell.git
cd literal-hell

# Install dependencies
npm install

# Run tests (when implemented)
npm test

# Build
npm run build

# Link for local development
npm link
```

### Adding Features

When adding new features:
1. Follow the modular structure
2. Add appropriate logging
3. Handle errors gracefully
4. Update tests (when implemented)
5. Document changes in README

### Key Design Decisions

1. **ESLint Integration**
   - Uses Vercel's Next.js ESLint config to match production behavior
   - Falls back to AST traversal if ESLint fails
   - Processes all files in a single ESLint run for efficiency

2. **Fix Application**
   - Processes fixes from end to start to avoid position shifts
   - Different handling for JSX vs string literals
   - Preserves file formatting and whitespace

3. **User Experience**
   - Shows context by default
   - Color-coded output
   - Clear success/error messages
   - Interactive but non-blocking

4. **Safety**
   - Verifies changes before writing
   - Prevents double-escaping
   - Handles file modifications
   - Preserves JSX structure

## Contributing

This tool was originally a solo vibe coding project, but contributions to improve it are welcome!

To contribute:
1. Fork the repository
2. Clone your fork: `git clone https://github.com/claren/literal-hell.git`
3. Create a feature branch: `git checkout -b my-new-feature`
4. Make your changes and commit them: `git commit -am 'Add some feature'`
5. Push to the branch: `git push origin my-new-feature`
6. Submit a pull request

### Possible Enhancements

- Add support for more file types
- Improve auto-detection of special patterns
- Create a configuration file for project-specific settings
- Add tests for better reliability
- Build a VS Code extension version
- Create a webpack/rollup plugin version

## License

This project is licensed under a modified MIT license with the following terms:

You are free to:
- Use this tool in commercial and non-commercial projects
- Modify and distribute the code
- Include it in your workflows and toolchains

Under the following terms:
- You may NOT sell this tool or charge for its use as a standalone product
- You must include the original copyright and license notice in any copy of the software
- Attribution is appreciated but not required

```THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Disclaimer

**BEST PRACTICES**

This tool modifies your source files. To use it safely:
- Always commit your code or backup files before running
- Review changes carefully, especially in critical files
- Run with `--verbose` the first few times to see exactly what's happening

The standard MIT license disclaimer above covers liability concerns.



