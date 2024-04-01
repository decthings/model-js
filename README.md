<img src="https://decthings.com/logo.png" alt="decthings logo" width="33%" />

## Decthings model using JavaScript

[![npm version](https://badge.fury.io/js/@decthings%2Fmodel.svg)](https://badge.fury.io/js/@decthings%2Fmodel.svg)

Use JavaScript/TypeScript to create a Decthings model.

### Setup

Create a Decthings model using JavaScript/TypeScript by going to the [create model page](https://app.decthings.com/models/create) on Decthings, and select JavaScript or TypeScript as the language. This package is then by default installed and used within your model.

Manually, you can install this as a dependency within your model using `npm install @decthings/model`.

### Execute a model

When you create a model you export it from your code using `export default`. There is of course also another side which imports the model and executes it. This is handled automatically by Decthings when you run a model in the cloud, but in case you want to run a Decthings model on your own system you can use the Rust crate [decthings-model-executor](https://github.com/decthings/model-executor).
