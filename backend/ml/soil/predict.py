import os
import json
import joblib
import pandas as pd
import numpy as np
from catboost import CatBoostClassifier

current_dir = os.path.dirname(os.path.abspath(__file__))

class SoilSuitabilityPredictor:
    """
    Reusable prediction pipeline for Smart Coop Soil Suitability inference.
    """
    def __init__(self, model_dir=None):
        if model_dir is None:
            model_dir = os.environ.get("SOIL_ML_PATH", current_dir)

        self.model_dir = model_dir
        self.metadata_path = os.path.join(model_dir, "model_metadata.json")
        self.label_encoder_path = os.path.join(model_dir, "label_encoder.pkl")
        self.feature_columns_path = os.path.join(model_dir, "feature_columns.pkl")
        
        if not os.path.exists(self.metadata_path):
            raise FileNotFoundError(f"Metadata file not found: {self.metadata_path}")
            
        with open(self.metadata_path, 'r') as f:
            self.metadata = json.load(f)
            
        self.model_type = self.metadata.get("model_type", "CatBoostClassifier")
        self.label_encoder = joblib.load(self.label_encoder_path)
        self.feature_columns = joblib.load(self.feature_columns_path)
        self.class_names = list(self.label_encoder.classes_)
        
        cbm_path = os.path.join(model_dir, "soil_suitability_model.cbm")
        if not os.path.exists(cbm_path):
            cbm_path = os.path.join(model_dir, "model.cbm")
            
        if os.path.exists(cbm_path):
            self.model = CatBoostClassifier()
            self.model.load_model(cbm_path)
        else:
            model_pkl = os.path.join(model_dir, "soil_suitability_model.pkl")
            self.model = joblib.load(model_pkl)

    def predict(self, input_data):
        """
        Accepts dict or pandas DataFrame of input features.
        Returns prediction dictionary with predicted_class and probabilities.
        """
        if isinstance(input_data, dict):
            df_in = pd.DataFrame([input_data])
        elif isinstance(input_data, pd.DataFrame):
            df_in = input_data.copy()
        else:
            raise ValueError("input_data must be a dictionary or pandas DataFrame")

        # Add engineered features if used during training
        if "NPK_sum" in self.feature_columns:
            npk_sum = df_in['N_score'] + df_in['P_score'] + df_in['K_score']
            df_in['NPK_sum'] = npk_sum
            df_in['N_ratio'] = df_in['N_score'] / (npk_sum + 1e-5)
            df_in['P_ratio'] = df_in['P_score'] / (npk_sum + 1e-5)
            df_in['K_ratio'] = df_in['K_score'] / (npk_sum + 1e-5)
            df_in['Temp_Humid_index'] = (df_in['Temperature'] * df_in['Humidity']) / 100.0

        # Ensure correct column ordering
        df_in = df_in[self.feature_columns]
        
        # Predict class index & probabilities
        preds = self.model.predict(df_in)
        if hasattr(preds, 'ravel'):
            preds = preds.ravel()
            
        pred_idx = int(preds[0])
        pred_label = str(self.label_encoder.inverse_transform([pred_idx])[0])
        
        probabilities = {}
        if hasattr(self.model, 'predict_proba'):
            probs = self.model.predict_proba(df_in)[0]
            for i, cls in enumerate(self.class_names):
                probabilities[cls] = round(float(probs[i]), 4)
                
        return {
            "predicted_soil_suitability": pred_label,
            "probabilities": probabilities,
            "inputs": input_data,
            "model_used": self.model_type,
            "model_version": self.metadata.get("model_version", "1.0.0")
        }
