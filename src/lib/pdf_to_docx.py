import sys
import os

def convert(pdf_path, docx_path):
    from pdf2docx import Converter
    cv = Converter(pdf_path)
    cv.convert(docx_path)
    cv.close()

if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit(1)
    
    input_pdf = os.path.abspath(sys.argv[1])
    output_docx = os.path.abspath(sys.argv[2])
    
    convert(input_pdf, output_docx)
