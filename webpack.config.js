const path = require('path');

module.exports = {
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
      'music-metadata': path.resolve(__dirname, 'node_modules/music-metadata/lib/index.js')
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
};
