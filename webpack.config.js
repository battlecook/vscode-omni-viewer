const path = require('path');

module.exports = [
  // TypeScript files configuration
  {
    target: 'node',
    mode: 'production',
    entry: {
      extension: './src/extension.ts',
      audioViewerProvider: './src/audioViewerProvider.ts',
      videoViewerProvider: './src/videoViewerProvider.ts',
      imageViewerProvider: './src/imageViewerProvider.ts',
      csvViewerProvider: './src/csvViewerProvider.ts',
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
        'hyparquet': path.resolve(__dirname, 'node_modules/hyparquet/src/node.js')
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
  }
];
