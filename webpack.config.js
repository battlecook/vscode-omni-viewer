const path = require('path');
const webpack = require('webpack');

module.exports = [
  // TypeScript files configuration
  {
    target: 'node',
    mode: 'production',
    entry: {
      extension: './src/extension.ts',
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
