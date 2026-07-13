#!/usr/bin/env node
import { runCli } from "@vsnap/cli";

process.exitCode = await runCli();
