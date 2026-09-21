import os
import sys
import json

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from soil_decision_engine import SoilDecisionEngine

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing input JSON payload argument"}))
        sys.exit(1)
        
    try:
        raw_arg = sys.argv[1]
        input_data = json.loads(raw_arg)
        engine = SoilDecisionEngine()
        result = engine.process_query(input_data)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
