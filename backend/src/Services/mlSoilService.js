const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const mlSoilDir = process.env.SOIL_ML_PATH || path.join(__dirname, '../../ml/soil');
const scriptPath = path.join(mlSoilDir, 'run_soil_engine.py');

class MlSoilService {
  constructor() {
    this.datasetPath = path.join(mlSoilDir, 'FINAL_SOIL_SUITABILITY_DATASET.csv');
    this.supportedDistricts = new Set();
    this.supportedCrops = new Set();
    this.loadDatasetMetadata();
  }

  loadDatasetMetadata() {
    try {
      if (!fs.existsSync(this.datasetPath)) return;
      // Read initial lines to get districts and crops
      const content = fs.readFileSync(this.datasetPath, 'utf8');
      const lines = content.split('\n');
      if (lines.length < 2) return;

      const header = lines[0].split(',').map(h => h.trim().toLowerCase());
      const distIdx = header.indexOf('district_name');
      const cropIdx = header.indexOf('crops');

      // Sample lines to populate sets
      const sampleLimit = Math.min(lines.length, 100000);
      for (let i = 1; i < sampleLimit; i++) {
        if (!lines[i]) continue;
        const cols = lines[i].split(',');
        if (distIdx !== -1 && cols[distIdx]) {
          this.supportedDistricts.add(cols[distIdx].trim().toLowerCase());
        }
        if (cropIdx !== -1 && cols[cropIdx]) {
          this.supportedCrops.add(cols[cropIdx].trim().toLowerCase());
        }
      }
    } catch (e) {
      console.error('Error loading dataset metadata in mlSoilService:', e);
    }
  }

  isDistrictSupported(district) {
    if (!district) return false;
    const clean = district.trim().toLowerCase();
    if (clean === 'chennai') return false; // Explicit check: Chennai is NOT in dataset
    return this.supportedDistricts.has(clean) || Array.from(this.supportedDistricts).some(d => clean.includes(d) || d.includes(clean));
  }

  isCropSupported(crop) {
    if (!crop) return false;
    const clean = crop.trim().toLowerCase();
    return this.supportedCrops.has(clean) || Array.from(this.supportedCrops).some(c => clean.includes(c) || c.includes(clean));
  }

  runDecisionEngine(inputData) {
    try {
      const pythonProcess = spawnSync('python', [scriptPath, JSON.stringify(inputData)], {
        encoding: 'utf8',
        env: { ...process.env, SOIL_ML_PATH: mlSoilDir }
      });

      if (pythonProcess.error) {
        console.error('Python ML execution error:', pythonProcess.error);
        return { error: pythonProcess.error.message };
      }

      const output = pythonProcess.stdout ? pythonProcess.stdout.trim() : '';
      if (!output) {
        console.error('Empty output from Python ML process:', pythonProcess.stderr);
        return { error: 'Empty output from ML engine' };
      }

      return JSON.parse(output);
    } catch (err) {
      console.error('Failed to run ML Decision Engine:', err);
      return { error: err.message };
    }
  }
}

module.exports = new MlSoilService();
