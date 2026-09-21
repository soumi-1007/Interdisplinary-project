import os
import sys
import json

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

try:
    from predict import SoilSuitabilityPredictor
    from diagnosis import SoilDiagnosisEngine
except ImportError:
    from .predict import SoilSuitabilityPredictor
    from .diagnosis import SoilDiagnosisEngine

class SoilDecisionEngine:
    """
    Complete Smart Coop Soil Suitability Decision + Diagnosis Engine.
    Combines trained CatBoost classifier prediction with verified agronomic diagnosis.
    Does NOT modify or override the CatBoost model verdict.
    """
    def __init__(self, model_dir=None, data_path=None):
        base_dir = os.environ.get("SOIL_ML_PATH", current_dir)
        if model_dir is None:
            model_dir = base_dir
        if data_path is None:
            data_path = os.path.join(base_dir, "FINAL_SOIL_SUITABILITY_DATASET.csv")

        self.predictor = SoilSuitabilityPredictor(model_dir=model_dir)
        self.diagnosis_engine = SoilDiagnosisEngine(data_path=data_path)

    def process_query(self, input_data):
        """
        Accepts farmer input dictionary.
        Returns complete structured verdict, probability distribution, factor diagnosis, reasons, and suggestions.
        """
        crop_input = input_data.get("CROPS", "")
        
        # Step 1: Check Crop Support
        if not self.diagnosis_engine.is_crop_supported(crop_input):
            return {
                "supported_crop": False,
                "prediction": None,
                "confidence": None,
                "probabilities": None,
                "factors": {},
                "reasons": ["Prediction is not available for this crop because it is outside the trained dataset."],
                "suggestions": ["Please query one of the 57 supported agricultural crops in Tamil Nadu."]
            }

        # Step 2: Get CatBoost Model Verdict & Probabilities
        model_result = self.predictor.predict(input_data)
        verdict = model_result["predicted_soil_suitability"]
        probs = model_result["probabilities"]
        confidence = max(probs.values()) if probs else 1.0

        # Step 3: Run Agronomic Factor Diagnosis
        diag_result = self.diagnosis_engine.diagnose_factors(
            crop=crop_input,
            temperature=input_data.get("Temperature", 0.0),
            humidity=input_data.get("Humidity", 0.0),
            moisture=input_data.get("Moisture", 0.0),
            n_score=input_data.get("N_score", 0.0),
            p_score=input_data.get("P_score", 0.0),
            k_score=input_data.get("K_score", 0.0)
        )

        # Step 4: Construct Combined Response
        return {
            "supported_crop": True,
            "prediction": verdict,
            "confidence": round(float(confidence), 4),
            "probabilities": probs,
            "factors": diag_result["factors"],
            "reasons": diag_result["reasons"],
            "suggestions": diag_result["suggestions"]
        }

if __name__ == "__main__":
    engine = SoilDecisionEngine()
    demo_input = {
        "Temperature": 35.0,
        "Humidity": 40.0,
        "Moisture": 30.0,
        "N_score": 0.5,
        "P_score": 0.0,
        "K_score": 0.5,
        "district_name": "Salem",
        "CROPS": "groundnut"
    }
    print(json.dumps(engine.process_query(demo_input), indent=2))
