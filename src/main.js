'use babel'

import Path from 'path'
import {CompositeDisposable} from 'atom'
import {spawnWorker} from './helpers'
import escapeHTML from 'escape-html'

module.exports = {
  config: {
    lintHtmlFiles: {
      title: 'Lint HTML Files',
      description: 'You should also add `eslint-plugin-html` to your .eslintrc plugins',
      type: 'boolean',
      default: false
    },
    useGlobalEslint: {
      title: 'Use global ESLint installation',
      description: 'Make sure you have it in your $PATH',
      type: 'boolean',
      default: false
    },
    showRuleIdInMessage: {
      title: 'Show Rule ID in Messages',
      type: 'boolean',
      default: true
    },
    disableWhenNoEslintConfig: {
      title: 'Disable when no ESLint config is found (in package.json or .eslintrc)',
      type: 'boolean',
      default: true
    },
    eslintrcPath: {
      title: '.eslintrc Path',
      description: "It will only be used when there's no config file in project",
      type: 'string',
      default: ''
    },
    globalNodePath: {
      title: 'Global Node Installation Path',
      description: 'Write the value of `npm get prefix` here',
      type: 'string',
      default: ''
    },
    eslintRulesDir: {
      title: 'ESLint Rules Dir',
      description: 'Specify a directory for ESLint to load rules from',
      type: 'string',
      default: ''
    },
    disableEslintIgnore: {
      title: 'Disable using .eslintignore files',
      type: 'boolean',
      default: false
    }
  },
  activate: function() {
    require('atom-package-deps').install()

    this.subscriptions = new CompositeDisposable()
    this.active = true
    this.worker = null
    this.scopes = ['source.js', 'source.jsx', 'source.js.jsx', 'source.babel', 'source.js-semantic']

    const embeddedScope = 'source.js.embedded.html'
    this.subscriptions.add(atom.config.observe('linter-eslint.lintHtmlFiles', lintHtmlFiles => {
      if (lintHtmlFiles) {
        this.scopes.push(embeddedScope)
      } else {
        if (this.scopes.indexOf(embeddedScope) !== -1) {
          this.scopes.splice(this.scopes.indexOf(embeddedScope), 1)
        }
      }
    }))
    this.subscriptions.add(atom.commands.add('atom-text-editor', {
      'linter-eslint:fix-file': () => {
        const textEditor = atom.workspace.getActiveTextEditor()
        const filePath = textEditor.getPath()
        const fileDir = Path.dirname(filePath)

        if (!textEditor || textEditor.isModified()) {
          // Abort for invalid or unsaved text editors
          atom.notifications.addError('Linter-ESLint: Please save before fixing')
          return
        }

        this.worker.request('job', {
          type: 'lint',
          config: atom.config.get('linter-eslint'),
          filePath: filePath
        }).then(function(response) {
          atom.notifications.addSuccess(response)
        }).catch(function(response) {
          atom.notifications.addWarning(response)
        })
      }
    }))

    const initializeWorker = () => {
      const {worker, subscription} = spawnWorker()
      this.worker = worker
      this.subscriptions.add(subscription)
      worker.onDidExit(() => {
        if (this.active) {
          atom.notifications.addWarning('[Linter-ESLint] Worker died unexpectedly', {detail: 'Check your console for more info. A new worker will be spawned instantly.', dismissable: true})
          setTimeout(initializeWorker, 1000)
        }
      })
    }
    initializeWorker()
  },
  deactivate: function() {
    this.active = false
    this.subscriptions.dispose()
  },
  provideLinter: function() {
    const Helpers = require('atom-linter')
    return {
      name: 'ESLint',
      grammarScopes: this.scopes,
      scope: 'file',
      lintOnFly: true,
      lint: textEditor => {
        const text = textEditor.getText()
        if (text.length === 0) {
          return Promise.resolve([])
        }
        const filePath = textEditor.getPath()
        const showRule = atom.config.get('linter-eslint.showRuleIdInMessage')

        return this.worker.request('job', {
          contents: text,
          type: 'lint',
          config: atom.config.get('linter-eslint'),
          filePath: filePath
        }).then(function(response) {
          return response.map(function({message, line, severity, ruleId, column}) {
            const range = Helpers.rangeFromLineNumber(textEditor, line - 1)
            if (column) {
              range[0][1] = column - 1
            }
            if (column > range[1][1]) {
              range[1][1] = column - 1
            }
            const ret = {
              filePath: filePath,
              type: severity === 1 ? 'Warning' : 'Error',
              range: range
            }
            if (showRule) {
              ret.html = `<span class="badge badge-flexible">${ruleId || 'Fatal'}</span> ${escapeHTML(message)}`
            } else {
              ret.text = message
            }
            return ret
          })
        })
      }
    }
  }
}
