import os
import sys

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

import pandas as pd

class SoilDiagnosisEngine:
    """
    Offline agricultural diagnosis engine for Smart Coop.
    Uses verified crop-specific requirements extracted directly from FINAL_SOIL_SUITABILITY_DATASET.csv.
    Does NOT invent agricultural thresholds or fertilizer quantities.
    """
    def __init__(self, data_path=None):
        if data_path is None:
            base_dir = os.environ.get("SOIL_ML_PATH", current_dir)
            data_path = os.path.join(base_dir, "FINAL_SOIL_SUITABILITY_DATASET.csv")

        self.data_path = data_path
        if not os.path.exists(data_path):
            raise FileNotFoundError(f"Dataset not found at: {data_path}")
            
        df = pd.read_csv(data_path)
        req_cols = [
            'min_temp', 'max_temp', 'min_humidity', 'max_humidity', 
            'min_ph', 'max_ph', 'N_requirement', 'P_requirement', 'K_requirement', 'water_requirement'
        ]
        
        # Build lookup table per crop (lower-case key mapping)
        crop_table = df.groupby('CROPS')[req_cols].first().reset_index()
        self.crop_requirements = {}
        for _, row in crop_table.iterrows():
            crop_name = str(row['CROPS']).strip().lower()
            self.crop_requirements[crop_name] = {
                "original_name": str(row['CROPS']).strip(),
                "min_temp": float(row['min_temp']),
                "max_temp": float(row['max_temp']),
                "min_humidity": float(row['min_humidity']),
                "max_humidity": float(row['max_humidity']),
                "min_ph": float(row['min_ph']),
                "max_ph": float(row['max_ph']),
                "N_requirement": str(row['N_requirement']).strip(),
                "P_requirement": str(row['P_requirement']).strip(),
                "K_requirement": str(row['K_requirement']).strip(),
                "water_requirement": str(row['water_requirement']).strip()
            }
            
    def is_crop_supported(self, crop):
        """Checks if crop is present in verified dataset."""
        if not crop:
            return False
        return crop.strip().lower() in self.crop_requirements

    def get_supported_crops(self):
        """Returns sorted list of supported crop names."""
        return sorted([req["original_name"] for req in self.crop_requirements.values()])

    def diagnose_factors(self, crop, temperature, humidity, moisture, n_score, p_score, k_score):
        """
        Analyzes 6 key input factors independently against verified crop requirements.
        Returns structured diagnosis dictionary.
        """
        crop_key = str(crop).strip().lower() if crop else ""
        if not self.is_crop_supported(crop_key):
            return {
                "supported_crop": False,
                "crop": crop,
                "message": "Prediction is not available for this crop because it is outside the trained dataset."
            }
            
        req = self.crop_requirements[crop_key]
        orig_crop_name = req["original_name"]
        
        factors = {}
        reasons = []
        suggestions = []
        
        # 1. Temperature Diagnosis
        temp_val = float(temperature)
        min_t, max_t = req["min_temp"], req["max_temp"]
        t_range_str = f"{min_t}°C - {max_t}°C" if min_t != max_t else f"{min_t}°C"
        
        if temp_val < min_t:
            t_status = "Below Range"
            t_msg = f"Temperature ({temp_val}°C) is below the suitable range for {orig_crop_name} ({t_range_str})."
            reasons.append(f"Temperature ({temp_val}°C) is below requirement ({t_range_str}).")
            suggestions.append("Current temperature is outside the preferred range for this crop.")
        elif temp_val > max_t:
            t_status = "Above Range"
            t_msg = f"Temperature ({temp_val}°C) is above the suitable range for {orig_crop_name} ({t_range_str})."
            reasons.append(f"Temperature ({temp_val}°C) is above requirement ({t_range_str}).")
            suggestions.append("Current temperature is outside the preferred range for this crop.")
        else:
            t_status = "Suitable"
            t_msg = f"Temperature ({temp_val}°C) is within the suitable range for {orig_crop_name} ({t_range_str})."
            
        factors["temperature"] = {
            "status": t_status,
            "value": temp_val,
            "required_range": [min_t, max_t],
            "message": t_msg
        }

        # 2. Humidity Diagnosis (Clean formatting when min_humidity == max_humidity)
        humid_val = float(humidity)
        min_h, max_h = req["min_humidity"], req["max_humidity"]
        h_range_str = f"{min_h}% - {max_h}%" if min_h != max_h else f"{min_h}%"
        
        if humid_val < min_h:
            h_status = "Below Range"
            h_msg = f"Humidity ({humid_val}%) is below the suitable target for {orig_crop_name} ({h_range_str})."
            reasons.append(f"Humidity ({humid_val}%) is below requirement ({h_range_str}).")
            suggestions.append("Current humidity is outside the preferred range for this crop.")
        elif humid_val > max_h:
            h_status = "Above Range"
            h_msg = f"Humidity ({humid_val}%) is above the suitable target for {orig_crop_name} ({h_range_str})."
            reasons.append(f"Humidity ({humid_val}%) is above requirement ({h_range_str}).")
            suggestions.append("Current humidity is outside the preferred range for this crop.")
        else:
            h_status = "Suitable"
            h_msg = f"Humidity ({humid_val}%) is within the suitable range for {orig_crop_name} ({h_range_str})."
            
        factors["humidity"] = {
            "status": h_status,
            "value": humid_val,
            "required_range": [min_h, max_h],
            "message": h_msg
        }

        # 3. Moisture Diagnosis (Based on crop water_requirement without inventing fake min/max lab thresholds)
        moist_val = float(moisture)
        w_req = req["water_requirement"]
        m_status = "Suitable"
        
        if w_req.lower() == "high" and moist_val < 60.0:
            m_status = "Low"
        elif w_req.lower() == "medium" and moist_val < 40.0:
            m_status = "Low"
        elif w_req.lower() == "low" and moist_val < 20.0:
            m_status = "Low"

        if m_status == "Low":
            m_msg = f"Moisture ({moist_val}%) is low for {orig_crop_name} (Water requirement: {w_req})."
            reasons.append(f"Moisture level ({moist_val}%) is low for the selected crop's water requirement ({w_req}).")
            suggestions.append("Improve soil moisture through appropriate water management.")
        else:
            m_msg = f"Moisture ({moist_val}%) is adequate for {orig_crop_name} (Water requirement: {w_req})."
            
        factors["moisture"] = {
            "status": m_status,
            "value": moist_val,
            "water_requirement": w_req,
            "message": m_msg
        }

        # 4. Nitrogen Score Diagnosis (Granular mapping for discrete scores 1.0, 0.5, 0.0)
        n_val = float(n_score)
        n_req = req["N_requirement"]
        if n_val == 1.0:
            n_status = "Suitable"
            n_msg = f"Nitrogen score ({n_val}) is optimal for {orig_crop_name}."
        elif n_val == 0.5:
            n_status = "Moderate"
            n_msg = f"Nitrogen score ({n_val}) is sub-optimal for {orig_crop_name} (Requirement: {n_req})."
            reasons.append(f"Nitrogen score ({n_val}) is sub-optimal.")
            suggestions.append("Improve nitrogen availability based on soil-test/agronomic recommendations.")
        else:
            n_status = "Low"
            n_msg = f"Nitrogen score ({n_val}) is deficient for {orig_crop_name} (Requirement: {n_req})."
            reasons.append(f"Nitrogen score ({n_val}) is deficient.")
            suggestions.append("Improve nitrogen availability based on soil-test/agronomic recommendations.")
            
        factors["nitrogen"] = {
            "status": n_status,
            "score": n_val,
            "requirement_level": n_req,
            "message": n_msg
        }

        # 5. Phosphorus Score Diagnosis
        p_val = float(p_score)
        p_req = req["P_requirement"]
        if p_val == 1.0:
            p_status = "Suitable"
            p_msg = f"Phosphorus score ({p_val}) is optimal for {orig_crop_name}."
        elif p_val == 0.5:
            p_status = "Moderate"
            p_msg = f"Phosphorus score ({p_val}) is sub-optimal for {orig_crop_name} (Requirement: {p_req})."
            reasons.append(f"Phosphorus score ({p_val}) is sub-optimal.")
            suggestions.append("Improve phosphorus availability based on soil-test/agronomic recommendations.")
        else:
            p_status = "Low"
            p_msg = f"Phosphorus score ({p_val}) is deficient for {orig_crop_name} (Requirement: {p_req})."
            reasons.append(f"Phosphorus score ({p_val}) is deficient.")
            suggestions.append("Improve phosphorus availability based on soil-test/agronomic recommendations.")
            
        factors["phosphorus"] = {
            "status": p_status,
            "score": p_val,
            "requirement_level": p_req,
            "message": p_msg
        }

        # 6. Potassium Score Diagnosis
        k_val = float(k_score)
        k_req = req["K_requirement"]
        if k_val == 1.0:
            k_status = "Suitable"
            k_msg = f"Potassium score ({k_val}) is optimal for {orig_crop_name}."
        elif k_val == 0.5:
            k_status = "Moderate"
            k_msg = f"Potassium score ({k_val}) is sub-optimal for {orig_crop_name} (Requirement: {k_req})."
            reasons.append(f"Potassium score ({k_val}) is sub-optimal.")
            suggestions.append("Improve potassium availability based on soil-test/agronomic recommendations.")
        else:
            k_status = "Low"
            k_msg = f"Potassium score ({k_val}) is deficient for {orig_crop_name} (Requirement: {k_req})."
            reasons.append(f"Potassium score ({k_val}) is deficient.")
            suggestions.append("Improve potassium availability based on soil-test/agronomic recommendations.")
            
        factors["potassium"] = {
            "status": k_status,
            "score": k_val,
            "requirement_level": k_req,
            "message": k_msg
        }

        # Deduplicate suggestions preserving order
        unique_suggestions = list(dict.fromkeys(suggestions))
        if not unique_suggestions:
            unique_suggestions.append("No major limiting factor was identified from the provided inputs.")

        return {
            "supported_crop": True,
            "crop": orig_crop_name,
            "factors": factors,
            "reasons": reasons,
            "suggestions": unique_suggestions
        }
