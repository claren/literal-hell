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

```
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
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



