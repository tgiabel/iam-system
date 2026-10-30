import os
import subprocess
import unittest
from pathlib import Path


class DetailSharedTests(unittest.TestCase):
    def test_detail_shared_in_node(self):
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run([os.environ.get('SOFA_NODE_BINARY', 'node'), 'tests/detail_shared_checks.js'],
                                cwd=root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_role_reevaluation_in_node(self):
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run([os.environ.get('SOFA_NODE_BINARY', 'node'), 'tests/role_reevaluation_checks.js'],
                                cwd=root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
