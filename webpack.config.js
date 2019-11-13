const path = require('path');

module.exports = {
    entry: './src/gridyourlions.ts',
    mode: 'production',
    target: 'node',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'gridyourlions.js'
    },
    resolve: {
        extensions: ['.ts', '.js'],
    }, module: {
        rules: [
            { test: /\.ts$/, use: 'ts-loader' }
        ]
    }
};