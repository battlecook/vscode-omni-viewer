const path = require('path');
const webpack = require('webpack');

module.exports = [
  // TypeScript files configuration
  {
    target: 'node',
    mode: 'production',
    entry: {
      extension: './src/extension.ts',
      tfliteParserWorker: './src/tfliteParserWorker.ts',
      pteParserWorker: './src/pteParserWorker.ts',
      kerasParserWorker: './src/kerasParserWorker.ts',
      coremlParserWorker: './src/coremlParserWorker.ts',
      harParserWorker: './src/harParserWorker.ts',
      audioViewerProvider: './src/audioViewerProvider.ts',
      audioEngine: './src/audioEngine.ts',
      videoViewerProvider: './src/videoViewerProvider.ts',
      imageViewerProvider: './src/imageViewerProvider.ts',
      csvViewerProvider: './src/csvViewerProvider.ts',
      wordViewerProvider: './src/wordViewerProvider.ts',
      psdViewerProvider: './src/psdViewerProvider.ts',
      'utils/fileUtils': './src/utils/fileUtils.ts',
      'utils/messageHandler': './src/utils/messageHandler.ts',
      'utils/templateUtils': './src/utils/templateUtils.ts'
    },
    output: {
      path: path.resolve(__dirname, 'out'),
      filename: '[name].js',
      libraryTarget: 'commonjs2',
      devtoolModuleFilenameTemplate: '../[resource-path]'
    },
    devtool: 'source-map',
    externals: {
      vscode: 'commonjs vscode'
    },
    resolve: {
      extensions: ['.ts', '.js'],
      alias: {
        'music-metadata': path.resolve(__dirname, 'node_modules/music-metadata/lib/index.js'),
        'hyparquet': path.resolve(__dirname, 'node_modules/hyparquet/src/node.js'),
        'path-source$': path.resolve(__dirname, 'node_modules/path-source/index.node.js'),
        'stream-source$': path.resolve(__dirname, 'node_modules/stream-source/index.node.js'),
        'yaml': path.resolve(__dirname, 'node_modules/yaml/dist/index.js')
      },
      extensionAlias: {
        '.js': ['.js', '.ts']
      }
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [
            {
              loader: 'ts-loader',
              options: {
                transpileOnly: true
              }
            }
          ]
        }
      ]
    }
  },
  // JavaScript files configuration for image viewer
  {
    mode: 'production',
    entry: {
      'templates/image/js/imageViewer': './src/templates/image/js/imageViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/image/js'),
      filename: 'imageViewer.js',
      libraryTarget: 'var',
      library: 'ImageViewer'
    },
    resolve: {
      extensions: ['.js']
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    }
  },
  // JavaScript files configuration for Markdown viewer
  {
    mode: 'production',
    target: 'web',
    entry: {
      'templates/markdown/js/markdownViewer': './src/templates/markdown/js/markdownViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/markdown/js'),
      filename: 'markdownViewer.js',
      libraryTarget: 'var',
      library: 'MarkdownViewer'
    },
    resolve: {
      extensions: ['.js']
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      minimize: true,
      usedExports: true,
      sideEffects: false
    },
    plugins: [
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1
      })
    ]
  },
  // JavaScript files configuration for PDF viewer (omni-viewer-core)
  {
    mode: 'production',
    target: 'web',
    entry: {
      'templates/pdf/js/pdfViewer': './src/templates/pdf/js/pdfViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/pdf/js'),
      filename: 'pdfViewer.js',
      libraryTarget: 'var',
      library: 'PdfViewer'
    },
    resolve: {
      extensions: ['.js'],
      fallback: {
        fs: false,
        path: false
      }
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      minimize: true,
      usedExports: true,
      sideEffects: false
    },
    plugins: [
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1
      })
    ]
  },
  // JavaScript files configuration for LaTeX viewer (omni-viewer-core)
  {
    mode: 'production',
    target: 'web',
    entry: {
      'templates/latex/js/latexViewer': './src/templates/latex/js/latexViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/latex/js'),
      filename: 'latexViewer.js',
      libraryTarget: 'var',
      library: 'LatexViewer'
    },
    resolve: {
      extensions: ['.js'],
      fallback: {
        fs: false,
        path: false
      }
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      minimize: true,
      usedExports: true,
      sideEffects: false
    },
    plugins: [
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1
      })
    ]
  },
  // JavaScript files configuration for Jupyter notebook viewer (omni-viewer-core)
  {
    mode: 'production',
    target: 'web',
    entry: {
      'templates/notebook/js/notebookViewer': './src/templates/notebook/js/notebookViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/notebook/js'),
      filename: 'notebookViewer.js',
      libraryTarget: 'var',
      library: 'NotebookViewer'
    },
    resolve: {
      extensions: ['.js'],
      fallback: {
        fs: false,
        path: false
      }
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      minimize: true,
      usedExports: true,
      sideEffects: false
    },
    plugins: [
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1
      })
    ]
  },
  // JavaScript files configuration for ONNX viewer (omni-viewer-core)
  {
    mode: 'production',
    target: 'web',
    entry: {
      'templates/onnx/js/onnxViewer': './src/templates/onnx/js/onnxViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/onnx/js'),
      filename: 'onnxViewer.js',
      libraryTarget: 'var',
      library: 'OnnxViewer'
    },
    resolve: {
      extensions: ['.js'],
      fallback: {
        fs: false,
        path: false
      }
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      minimize: true,
      usedExports: true,
      sideEffects: false
    },
    plugins: [
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1
      })
    ]
  },
  // JavaScript files configuration for GGUF viewer (omni-viewer-core)
  {
    mode: 'production',
    target: 'web',
    entry: {
      'templates/gguf/js/ggufViewer': './src/templates/gguf/js/ggufViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/gguf/js'),
      filename: 'ggufViewer.js',
      libraryTarget: 'var',
      library: 'GgufViewer'
    },
    resolve: {
      extensions: ['.js'],
      fallback: {
        fs: false,
        path: false
      }
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      minimize: true,
      usedExports: true,
      sideEffects: false
    },
    plugins: [
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1
      })
    ]
  },
  // JavaScript files configuration for TFLite viewer (omni-viewer-core)
  {
    mode: 'production',
    target: 'web',
    entry: {
      'templates/tflite/js/tfliteViewer': './src/templates/tflite/js/tfliteViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/tflite/js'),
      filename: 'tfliteViewer.js',
      libraryTarget: 'var',
      library: 'TfliteViewer'
    },
    resolve: {
      extensions: ['.js'],
      fallback: {
        fs: false,
        path: false
      }
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      minimize: true,
      usedExports: true,
      sideEffects: false
    },
    plugins: [
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1
      })
    ]
  },
  // JavaScript files configuration for ExecuTorch viewer (omni-viewer-core)
  {
    mode: 'production',
    target: 'web',
    entry: {
      'templates/pte/js/pteViewer': './src/templates/pte/js/pteViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/pte/js'),
      filename: 'pteViewer.js',
      libraryTarget: 'var',
      library: 'PteViewer'
    },
    resolve: {
      extensions: ['.js'],
      fallback: {
        fs: false,
        path: false
      }
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      minimize: true,
      usedExports: true,
      sideEffects: false
    },
    plugins: [
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1
      })
    ]
  },
  // JavaScript files configuration for Keras viewer (omni-viewer-core)
  {
    mode: 'production',
    target: 'web',
    entry: {
      'templates/keras/js/kerasViewer': './src/templates/keras/js/kerasViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/keras/js'),
      filename: 'kerasViewer.js',
      libraryTarget: 'var',
      library: 'KerasViewer'
    },
    resolve: {
      extensions: ['.js'],
      fallback: {
        fs: false,
        path: false
      }
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      minimize: true,
      usedExports: true,
      sideEffects: false
    },
    plugins: [
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1
      })
    ]
  },
  // JavaScript files configuration for Core ML viewer (omni-viewer-core)
  {
    mode: 'production',
    target: 'web',
    entry: {
      'templates/coreml/js/coremlViewer': './src/templates/coreml/js/coremlViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/coreml/js'),
      filename: 'coremlViewer.js',
      libraryTarget: 'var',
      library: 'CoremlViewer'
    },
    resolve: {
      extensions: ['.js'],
      fallback: {
        fs: false,
        path: false
      }
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      minimize: true,
      usedExports: true,
      sideEffects: false
    },
    plugins: [
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1
      })
    ]
  },
  // JavaScript files configuration for HAR viewer (omni-viewer-core)
  {
    mode: 'production',
    target: 'web',
    entry: {
      'templates/har/js/harViewer': './src/templates/har/js/harViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/har/js'),
      filename: 'harViewer.js',
      libraryTarget: 'var',
      library: 'HarViewer'
    },
    resolve: {
      extensions: ['.js'],
      fallback: {
        fs: false,
        path: false
      }
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      minimize: true,
      usedExports: true,
      sideEffects: false
    },
    plugins: [
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1
      })
    ]
  },
  // JavaScript files configuration for Safetensors viewer
  {
    mode: 'production',
    target: 'web',
    entry: {
      'templates/safetensors/js/safetensorsViewer': './src/templates/safetensors/js/safetensorsViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/safetensors/js'),
      filename: 'safetensorsViewer.js',
      libraryTarget: 'var',
      library: 'SafetensorsViewer'
    },
    resolve: {
      extensions: ['.js'],
      fallback: {
        fs: false,
        path: false
      }
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      minimize: true,
      usedExports: true,
      sideEffects: false
    },
    plugins: [
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1
      })
    ]
  },
  // JavaScript files configuration for Mermaid viewer
  {
    mode: 'production',
    target: 'web',
    entry: {
      'templates/mermaid/js/mermaidViewer': './src/templates/mermaid/js/mermaidViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/mermaid/js'),
      filename: 'mermaidViewer.js',
      libraryTarget: 'var',
      library: 'MermaidViewer'
    },
    resolve: {
      extensions: ['.js']
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      minimize: true,
      usedExports: true,
      sideEffects: false
    },
    plugins: [
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1
      })
    ]
  },
  // JavaScript files configuration for PlantUML viewer
  {
    mode: 'production',
    target: 'web',
    entry: {
      'templates/plantuml/js/plantumlViewer': './src/templates/plantuml/js/plantumlViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/plantuml/js'),
      filename: 'plantumlViewer.js',
      libraryTarget: 'var',
      library: 'PlantumlViewer'
    },
    resolve: {
      extensions: ['.js']
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      minimize: true,
      usedExports: true,
      sideEffects: false
    }
  },
  // JavaScript files configuration for audio viewer
  {
    mode: 'production',
    entry: {
      'templates/audio/js/audioViewer': './src/templates/audio/js/audioViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/audio/js'),
      filename: 'audioViewer.js',
      libraryTarget: 'var',
      library: 'AudioViewer'
    },
    resolve: {
      extensions: ['.js']
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      minimize: true,
      usedExports: true,
      sideEffects: false
    }
  },
  // JavaScript files configuration for HWP viewer
  {
    mode: 'production',
    target: 'web',
    entry: {
      'templates/hwp/js/hwpViewer': './src/templates/hwp/js/hwpViewerMain.js'
    },
    output: {
      path: path.resolve(__dirname, 'src/templates/hwp/js'),
      filename: 'hwpViewer.js',
      libraryTarget: 'var',
      library: 'HwpViewer'
    },
    resolve: {
      extensions: ['.js'],
      fallback: {
        fs: false
      }
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      minimize: true,
      usedExports: true,
      sideEffects: false
    }
  }
];
